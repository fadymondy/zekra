package account

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"

	"github.com/togo-framework/auth"
)

// Profile photos. The cropped image goes to the kernel's storage under
// avatars/<user>/<hash>.<ext>; account_profiles.avatar keeps the URL that serves
// it, so no column is added and an https avatar URL still works as before.

const maxAvatarBytes = 2 << 20

const avatarPrefix = "/api/account/avatar/"

var avatarTypes = map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

// sniffAvatar returns the content type for PNG, JPEG or WebP, else "".
func sniffAvatar(b []byte) string {
	ct := http.DetectContentType(b)
	if _, ok := avatarTypes[ct]; ok {
		return ct
	}
	return ""
}

func avatarBlobs(k *togo.Kernel) togo.Storage {
	if k != nil && k.Storage != nil {
		return k.Storage
	}
	dir := os.Getenv("STORAGE_DIR")
	if dir == "" {
		dir = "storage"
	}
	return dirBlobs{root: dir}
}

type dirBlobs struct{ root string }

func (d dirBlobs) Path(p string) string { return filepath.Join(d.root, filepath.FromSlash(p)) }
func (d dirBlobs) Put(p string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(d.Path(p)), 0o755); err != nil {
		return err
	}
	return os.WriteFile(d.Path(p), data, 0o644)
}
func (d dirBlobs) Get(p string) ([]byte, error) { return os.ReadFile(d.Path(p)) }
func (d dirBlobs) Delete(p string) error        { return os.Remove(d.Path(p)) }

// avatarKey maps a served URL (/api/account/avatar/<user>/<file>) back to its storage key.
func avatarKey(u string) string {
	rest, ok := strings.CutPrefix(u, avatarPrefix)
	if !ok || strings.Contains(rest, "..") || strings.Count(rest, "/") != 1 {
		return ""
	}
	return "avatars/" + rest
}

// RegisterAvatar mounts POST/DELETE /api/me/account/avatar and GET /api/account/avatar/{user}/{file}.
func (s *Service) RegisterAvatar(r chi.Router, blobs togo.Storage) {
	current := func(req *http.Request) string {
		var u string
		_ = s.DB.QueryRowContext(req.Context(), `SELECT avatar FROM account_profiles WHERE user_id = $1`, userOf(req)).Scan(&u)
		return u
	}
	setAvatar := func(req *http.Request, u string) error {
		_, err := s.DB.ExecContext(req.Context(), `
			INSERT INTO account_profiles (user_id, avatar) VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET avatar = EXCLUDED.avatar, updated_at = now()`, userOf(req), u)
		return err
	}
	guard := func(w http.ResponseWriter, req *http.Request) bool {
		if userOf(req) == "" {
			writeJSONErr(w, http.StatusUnauthorized, "sign in first")
			return false
		}
		if !csrfOK(req) {
			writeJSONErr(w, http.StatusForbidden, "missing or invalid CSRF token")
			return false
		}
		return true
	}

	r.Post("/api/me/account/avatar", func(w http.ResponseWriter, req *http.Request) {
		if !guard(w, req) {
			return
		}
		req.Body = http.MaxBytesReader(w, req.Body, maxAvatarBytes+(64<<10))
		if err := req.ParseMultipartForm(maxAvatarBytes + (64 << 10)); err != nil {
			writeJSONErr(w, http.StatusRequestEntityTooLarge, "the photo is at most 2 MB (multipart form expected)")
			return
		}
		f, _, err := req.FormFile("file")
		if err != nil {
			writeJSONErr(w, http.StatusBadRequest, "file is required")
			return
		}
		defer f.Close()
		data, err := io.ReadAll(io.LimitReader(f, maxAvatarBytes+1))
		if err != nil || len(data) > maxAvatarBytes {
			writeJSONErr(w, http.StatusRequestEntityTooLarge, "the photo is at most 2 MB")
			return
		}
		ct := sniffAvatar(data)
		if ct == "" {
			writeJSONErr(w, http.StatusUnsupportedMediaType, "PNG, JPEG or WebP only")
			return
		}
		sum := sha256.Sum256(data)
		file := hex.EncodeToString(sum[:])[:16] + "." + avatarTypes[ct]
		uid := userOf(req)
		u := avatarPrefix + uid + "/" + file
		if err := blobs.Put("avatars/"+uid+"/"+file, data); err != nil {
			writeJSONErr(w, http.StatusInternalServerError, "could not store the photo")
			return
		}
		old := current(req)
		if err := setAvatar(req, u); err != nil {
			_ = blobs.Delete("avatars/" + uid + "/" + file)
			writeJSONErr(w, http.StatusInternalServerError, "could not save the photo")
			return
		}
		if k := avatarKey(old); k != "" && old != u {
			_ = blobs.Delete(k)
		}
		writeJSON(w, http.StatusOK, map[string]any{"avatar": u})
	})

	r.Delete("/api/me/account/avatar", func(w http.ResponseWriter, req *http.Request) {
		if !guard(w, req) {
			return
		}
		old := current(req)
		if err := setAvatar(req, ""); err != nil {
			writeJSONErr(w, http.StatusInternalServerError, "could not remove the photo")
			return
		}
		if k := avatarKey(old); k != "" {
			_ = blobs.Delete(k)
		}
		writeJSON(w, http.StatusOK, map[string]any{"avatar": ""})
	})

	// Served only while it is still the user's current photo; the file name is the
	// content hash, so it caches as immutable.
	r.Get(avatarPrefix+"{user}/{file}", func(w http.ResponseWriter, req *http.Request) {
		uid, file := chi.URLParam(req, "user"), chi.URLParam(req, "file")
		u := avatarPrefix + uid + "/" + file
		var cur string
		_ = s.DB.QueryRowContext(req.Context(), `SELECT avatar FROM account_profiles WHERE user_id::text = $1`, uid).Scan(&cur)
		key := avatarKey(u)
		if cur != u || key == "" {
			http.NotFound(w, req)
			return
		}
		data, err := blobs.Get(key)
		if err != nil {
			http.NotFound(w, req)
			return
		}
		w.Header().Set("Content-Type", sniffAvatar(data))
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(data)
	})
}

func userOf(req *http.Request) string {
	if id, ok := auth.IdentityFrom(req.Context()); ok && id != nil {
		return id.ID
	}
	return ""
}
