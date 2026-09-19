package brain

/*
Brain profiles — per-brain settings (display name, description, colour, icon,
avatar / cover image, advisory visibility, default note category, free-form
settings). Table: brain_profiles (schema.sql). A brain with no row gets defaults:
display_name = namespace, colour from a deterministic palette.

The namespace id is immutable; only the display name is renamed.

Access:
  - read (GET profile, GET image): anyone who can read the brain;
  - full edit (every field, images): the brain owner, an admin, or a scoped ACL
    token with write (canAdmin);
  - limited edit: an editor (write without admin) may change description and color
    only; any other field in the PATCH is refused with 403.

Images are blobs in the kernel storage (togo.Storage: the filesystem driver under
STORAGE_DIR by default, S3/R2/MinIO when one is configured) under
brains/<ns>/<kind>-<sha12>.<ext>. They are never public: the console loads them
through GET /api/brain/profile/image/{ns}/{kind}, which checks read access and
serves an ETag. SVG is rejected (script-capable); PNG, JPEG and WebP up to 2 MB.
*/

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/togo-framework/togo"
)

// BrainPalette is the named colour set; a profile colour is one of these keys or
// a #rrggbb hex.
var BrainPalette = []struct{ Key, Hex string }{
	{"slate", "#64748b"}, {"red", "#ef4444"}, {"orange", "#f97316"}, {"amber", "#f59e0b"},
	{"lime", "#84cc16"}, {"green", "#22c55e"}, {"teal", "#14b8a6"}, {"cyan", "#06b6d4"},
	{"blue", "#3b82f6"}, {"indigo", "#6366f1"}, {"violet", "#8b5cf6"}, {"pink", "#ec4899"},
}

var hexColorRE = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// defaultColor picks a palette key from the namespace (stable across restarts).
func defaultColor(ns string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(ns))
	return BrainPalette[int(h.Sum32()%uint32(len(BrainPalette)))].Key
}

// colorHex resolves a palette key or hex to a hex.
func colorHex(c string) string {
	for _, p := range BrainPalette {
		if p.Key == c {
			return p.Hex
		}
	}
	if hexColorRE.MatchString(c) {
		return strings.ToLower(c)
	}
	return ""
}

// normalizeColor validates a palette key or #rrggbb.
func normalizeColor(c string) (string, bool) {
	c = strings.ToLower(strings.TrimSpace(c))
	if c == "" {
		return "", true // "" = back to the default
	}
	if colorHex(c) == "" {
		return "", false
	}
	return c, true
}

// ProfileSummary is the part of a profile that brain lists carry.
type ProfileSummary struct {
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	Color       string `json:"color"`
	ColorHex    string `json:"colorHex"`
	Icon        string `json:"icon"`
	ImageURL    string `json:"imageUrl"`
}

// BrainProfile is one brain's settings.
type BrainProfile struct {
	Namespace string `json:"namespace"`
	ProfileSummary
	CoverURL            string         `json:"coverUrl"`
	Visibility          string         `json:"visibility"`
	DefaultNoteCategory string         `json:"defaultNoteCategory"`
	Settings            map[string]any `json:"settings"`
	CreatedAt           *time.Time     `json:"createdAt,omitempty"`
	UpdatedAt           *time.Time     `json:"updatedAt,omitempty"`
	UpdatedBy           string         `json:"updatedBy,omitempty"`
	Persisted           bool           `json:"persisted"` // false = defaults, no row yet

	imageKey, coverKey string
}

func defaultProfile(ns string) BrainProfile {
	return BrainProfile{Namespace: ns, ProfileSummary: ProfileSummary{DisplayName: ns}, Visibility: "private", Settings: map[string]any{}}
}

// fill applies the defaults to empty fields.
func (p *BrainProfile) fill() {
	if strings.TrimSpace(p.DisplayName) == "" {
		p.DisplayName = p.Namespace
	}
	if p.Color == "" || colorHex(p.Color) == "" {
		p.Color = defaultColor(p.Namespace)
	}
	p.ColorHex = colorHex(p.Color)
	if p.Visibility == "" {
		p.Visibility = "private"
	}
	if p.Settings == nil {
		p.Settings = map[string]any{}
	}
}

const profileCols = `namespace, display_name, description, color, icon, image_url, image_key, cover_url, cover_key,
	visibility, default_note_category, settings, created_at, updated_at, COALESCE(updated_by,'')`

func scanProfile(sc interface{ Scan(...any) error }) (BrainProfile, error) {
	var p BrainProfile
	var settings []byte
	var ca, ua time.Time
	err := sc.Scan(&p.Namespace, &p.DisplayName, &p.Description, &p.Color, &p.Icon, &p.ImageURL, &p.imageKey,
		&p.CoverURL, &p.coverKey, &p.Visibility, &p.DefaultNoteCategory, &settings, &ca, &ua, &p.UpdatedBy)
	if err != nil {
		return p, err
	}
	_ = json.Unmarshal(settings, &p.Settings)
	p.CreatedAt, p.UpdatedAt, p.Persisted = &ca, &ua, true
	p.fill()
	return p, nil
}

// Profile returns a brain's profile (defaults when there is no row).
func (s *Store) Profile(ctx context.Context, ns string) (BrainProfile, error) {
	p := defaultProfile(ns)
	db, err := s.db(ctx)
	if err != nil {
		p.fill()
		return p, err
	}
	got, err := scanProfile(db.QueryRowContext(ctx, `SELECT `+profileCols+` FROM brain_profiles WHERE namespace=$1`, ns))
	if errors.Is(err, sql.ErrNoRows) {
		p.fill()
		return p, nil
	}
	if err != nil {
		p.fill()
		return p, err
	}
	return got, nil
}

// ProfileSummaries returns the list-view profile of each namespace (defaults for
// brains without a row). One query for the whole list.
func (s *Store) ProfileSummaries(ctx context.Context, nss []string) map[string]ProfileSummary {
	out := make(map[string]ProfileSummary, len(nss))
	for _, ns := range nss {
		p := defaultProfile(ns)
		p.fill()
		out[ns] = p.ProfileSummary
	}
	if len(nss) == 0 {
		return out
	}
	db, err := s.db(ctx)
	if err != nil {
		return out
	}
	rows, err := db.QueryContext(ctx, `SELECT `+profileCols+` FROM brain_profiles WHERE namespace = ANY($1)`, stringArray(nss))
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		if p, err := scanProfile(rows); err == nil {
			out[p.Namespace] = p.ProfileSummary
		}
	}
	return out
}

// ProfilePatch is a partial update; nil = unchanged.
type ProfilePatch struct {
	Namespace           string          `json:"namespace"`
	DisplayName         *string         `json:"displayName"`
	Description         *string         `json:"description"`
	Color               *string         `json:"color"`
	Icon                *string         `json:"icon"`
	ImageURL            *string         `json:"imageUrl"`
	CoverURL            *string         `json:"coverUrl"`
	Visibility          *string         `json:"visibility"`
	DefaultNoteCategory *string         `json:"defaultNoteCategory"`
	Settings            json.RawMessage `json:"settings"`
}

// onlyLimited reports whether the patch touches only what an editor may change.
func (p ProfilePatch) onlyLimited() bool {
	return p.DisplayName == nil && p.Icon == nil && p.ImageURL == nil && p.CoverURL == nil &&
		p.Visibility == nil && p.DefaultNoteCategory == nil && len(p.Settings) == 0
}

const (
	maxDisplayName = 80
	maxDescription = 2000
	maxIcon        = 32
	maxURL         = 1024
	maxSettings    = 16 << 10
	maxImageBytes  = 2 << 20
)

func profileErr(msg string) error { return fmt.Errorf("%w: %s", ErrInvalidInput, msg) }

func cleanText(s string, max int, multiline bool) (string, bool) {
	s = strings.TrimSpace(s)
	if !utf8.ValidString(s) || utf8.RuneCountInString(s) > max {
		return "", false
	}
	for _, r := range s {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\r' || r == '\t')) {
			return "", false
		}
	}
	return s, true
}

// validExternalURL accepts "" (clear), an absolute http(s) URL, or one of our
// own image routes.
func validExternalURL(u string) bool {
	if u == "" {
		return true
	}
	if len(u) > maxURL {
		return false
	}
	if strings.HasPrefix(u, "/api/brain/profile/image/") {
		return !strings.ContainsAny(u, " \"'<>\\")
	}
	pu, err := url.Parse(u)
	return err == nil && (pu.Scheme == "https" || pu.Scheme == "http") && pu.Host != "" && pu.User == nil
}

type profileSets struct {
	sets []string
	args []any
}

// UpdateProfile validates and applies a patch, creating the row on first write.
func (s *Store) UpdateProfile(ctx context.Context, in ProfilePatch, by string) (BrainProfile, error) {
	ps, err := buildProfileSets(in)
	if err != nil {
		return BrainProfile{}, err
	}
	if err := s.writeProfile(ctx, in.Namespace, ps.sets, ps.args, by); err != nil {
		return BrainProfile{}, err
	}
	return s.Profile(ctx, in.Namespace)
}

// buildProfileSets validates a patch into UPDATE assignments ($1 = namespace).
func buildProfileSets(in ProfilePatch) (profileSets, error) {
	sets := []string{}
	args := []any{in.Namespace}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
	}
	if in.DisplayName != nil {
		v, ok := cleanText(*in.DisplayName, maxDisplayName, false)
		if !ok {
			return profileSets{}, profileErr(fmt.Sprintf("displayName is at most %d characters, no control characters", maxDisplayName))
		}
		add("display_name", v)
	}
	if in.Description != nil {
		v, ok := cleanText(*in.Description, maxDescription, true)
		if !ok {
			return profileSets{}, profileErr(fmt.Sprintf("description is at most %d characters", maxDescription))
		}
		add("description", v)
	}
	if in.Color != nil {
		v, ok := normalizeColor(*in.Color)
		if !ok {
			return profileSets{}, profileErr("color must be #rrggbb or a palette key")
		}
		add("color", v)
	}
	if in.Icon != nil {
		v, ok := cleanText(*in.Icon, maxIcon, false)
		if !ok {
			return profileSets{}, profileErr(fmt.Sprintf("icon is at most %d characters", maxIcon))
		}
		add("icon", v)
	}
	for _, u := range []struct {
		v        *string
		col, key string
	}{{in.ImageURL, "image_url", "image_key"}, {in.CoverURL, "cover_url", "cover_key"}} {
		if u.v == nil {
			continue
		}
		v := strings.TrimSpace(*u.v)
		if !validExternalURL(v) {
			return profileSets{}, profileErr("image URLs must be absolute http(s) URLs")
		}
		if strings.HasPrefix(v, "/api/") {
			continue // our own route: set by upload only, never re-pointed by a patch
		}
		add(u.col, v)
		add(u.key, "") // an external URL replaces an uploaded blob (the caller deletes it)
	}
	if in.Visibility != nil {
		v := strings.TrimSpace(*in.Visibility)
		if v != "private" && v != "internal" {
			return profileSets{}, profileErr("visibility is private or internal")
		}
		add("visibility", v)
	}
	if in.DefaultNoteCategory != nil {
		v := strings.TrimSpace(*in.DefaultNoteCategory)
		if v != "" {
			c, err := noteCategory(v)
			if err != nil {
				return profileSets{}, profileErr("defaultNoteCategory is not a valid category name")
			}
			v = c
		}
		add("default_note_category", v)
	}
	if len(in.Settings) > 0 && string(in.Settings) != "null" {
		if len(in.Settings) > maxSettings {
			return profileSets{}, profileErr("settings is at most 16 KB")
		}
		var m map[string]any
		if err := json.Unmarshal(in.Settings, &m); err != nil {
			return profileSets{}, profileErr("settings must be a JSON object")
		}
		add("settings", string(in.Settings))
	}
	return profileSets{sets: sets, args: args}, nil
}

func (s *Store) writeProfile(ctx context.Context, ns string, sets []string, args []any, by string) error {
	if ns == "" {
		return ErrInvalidInput
	}
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO brain_profiles (namespace, updated_by) VALUES ($1,$2) ON CONFLICT (namespace) DO NOTHING`, ns, nullStr(by)); err != nil {
		return err
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, nullStr(by))
	q := `UPDATE brain_profiles SET ` + strings.Join(sets, ", ") + fmt.Sprintf(", updated_by=$%d, updated_at=now() WHERE namespace=$1", len(args))
	_, err = db.ExecContext(ctx, q, args...)
	return err
}

// setProfileImage records an uploaded (or removed: key "") image.
func (s *Store) setProfileImage(ctx context.Context, ns, kind, url, key, by string) error {
	col, kcol := "image_url", "image_key"
	if kind == "cover" {
		col, kcol = "cover_url", "cover_key"
	}
	return s.writeProfile(ctx, ns, []string{col + "=$2", kcol + "=$3"}, []any{ns, url, key}, by)
}

// DeleteProfile drops a brain's profile row, returning its blob keys.
func (s *Store) DeleteProfile(ctx context.Context, ns string) []string {
	p, err := s.Profile(ctx, ns)
	if err != nil || !p.Persisted {
		return nil
	}
	if db, err := s.db(ctx); err == nil {
		_, _ = db.ExecContext(ctx, `DELETE FROM brain_profiles WHERE namespace=$1`, ns)
	}
	return nonEmpty(p.imageKey, p.coverKey)
}

func nonEmpty(v ...string) []string {
	out := []string{}
	for _, s := range v {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// --- storage -------------------------------------------------------------------

// blobs is the kernel storage, or a filesystem store under STORAGE_DIR when no
// storage provider registered (tests, a bare kernel).
func (s *Service) blobs() togo.Storage {
	if s.k != nil && s.k.Storage != nil {
		return s.k.Storage
	}
	dir := os.Getenv("STORAGE_DIR")
	if dir == "" {
		dir = "storage"
	}
	return fsBlobs{root: dir}
}

type fsBlobs struct{ root string }

func (f fsBlobs) Path(p string) string { return filepath.Join(f.root, filepath.Clean("/"+p)) }
func (f fsBlobs) Put(p string, b []byte) error {
	if err := os.MkdirAll(filepath.Dir(f.Path(p)), 0o755); err != nil {
		return err
	}
	return os.WriteFile(f.Path(p), b, 0o644)
}
func (f fsBlobs) Get(p string) ([]byte, error) { return os.ReadFile(f.Path(p)) }
func (f fsBlobs) Delete(p string) error        { return os.Remove(f.Path(p)) }

var imageTypes = map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

// sniffImage returns the content type of an allowed raster image ("" otherwise).
func sniffImage(b []byte) string {
	ct := http.DetectContentType(b)
	if _, ok := imageTypes[ct]; ok {
		return ct
	}
	return ""
}

func validKind(k string) bool { return k == "image" || k == "cover" }

// --- access ----------------------------------------------------------------------

// profileEditLevel is "full" (owner/admin), "limited" (editor: description and
// color) or "none".
func (s *Service) profileEditLevel(r *http.Request, ns string) string {
	switch {
	case s.canAdmin(r, ns):
		return "full"
	case s.canWrite(r, ns):
		return "limited"
	default:
		return "none"
	}
}

// --- handlers --------------------------------------------------------------------

// GetProfile — GET /api/brain/profile?namespace=
func (s *Service) GetProfile(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	p, err := s.Store.Profile(r.Context(), ns)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.profileBody(r, p))
}

func (s *Service) profileBody(r *http.Request, p BrainProfile) map[string]any {
	palette := make([]map[string]string, len(BrainPalette))
	for i, c := range BrainPalette {
		palette[i] = map[string]string{"key": c.Key, "hex": c.Hex}
	}
	return map[string]any{"profile": p, "edit": s.profileEditLevel(r, p.Namespace), "palette": palette}
}

// PatchProfile — PATCH /api/brain/profile {namespace, …fields}
func (s *Service) PatchProfile(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	var in ProfilePatch
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "bad JSON body"))
		return
	}
	in.Namespace = strings.TrimSpace(in.Namespace)
	switch s.profileEditLevel(r, in.Namespace) {
	case "full":
	case "limited":
		if !in.onlyLimited() {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "editors may change the description and color only"))
			return
		}
	default:
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+in.Namespace))
		return
	}
	before, _ := s.Store.Profile(r.Context(), in.Namespace)
	p, err := s.Store.UpdateProfile(r.Context(), in, s.identify(r).agent)
	if err != nil {
		writeErr(w, err)
		return
	}
	// An external URL replaced an uploaded blob: drop the blob.
	if before.imageKey != "" && p.imageKey == "" {
		_ = s.blobs().Delete(before.imageKey)
	}
	if before.coverKey != "" && p.coverKey == "" {
		_ = s.blobs().Delete(before.coverKey)
	}
	s.publishProfile(p, "update")
	writeJSON(w, http.StatusOK, s.profileBody(r, p))
}

func (s *Service) publishProfile(p BrainProfile, action string) {
	s.hub.publish("brain", map[string]any{"namespace": p.Namespace, "action": "profile", "op": action,
		"displayName": p.DisplayName, "color": p.Color, "colorHex": p.ColorHex, "icon": p.Icon, "imageUrl": p.ImageURL})
}

// UploadProfileImage — POST /api/brain/profile/image (multipart: namespace, kind=image|cover, file)
func (s *Service) UploadProfileImage(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes+(64<<10))
	if err := r.ParseMultipartForm(maxImageBytes + (64 << 10)); err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiErr("too_large", "the image is at most 2 MB (multipart form expected)"))
		return
	}
	ns := strings.TrimSpace(r.FormValue("namespace"))
	kind := r.FormValue("kind")
	if kind == "" {
		kind = "image"
	}
	if !validKind(kind) {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "kind is image or cover"))
		return
	}
	if !s.canAdmin(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the brain's owner can change its images"))
		return
	}
	f, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "file is required"))
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxImageBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "could not read the file"))
		return
	}
	if len(data) > maxImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiErr("too_large", "the image is at most 2 MB"))
		return
	}
	ct := sniffImage(data)
	if ct == "" {
		writeJSON(w, http.StatusUnsupportedMediaType, apiErr("unsupported_type", "PNG, JPEG or WebP only (SVG is not accepted)"))
		return
	}
	sum := sha256.Sum256(data)
	tag := hex.EncodeToString(sum[:])[:12]
	key := fmt.Sprintf("brains/%s/%s-%s.%s", safeSegment(ns), kind, tag, imageTypes[ct])
	if err := s.blobs().Put(key, data); err != nil {
		writeErr(w, err)
		return
	}
	before, _ := s.Store.Profile(r.Context(), ns)
	u := profileImageURL(ns, kind, tag)
	if err := s.Store.setProfileImage(r.Context(), ns, kind, u, key, s.identify(r).agent); err != nil {
		_ = s.blobs().Delete(key)
		writeErr(w, err)
		return
	}
	if old := before.keyOf(kind); old != "" && old != key {
		_ = s.blobs().Delete(old)
	}
	p, _ := s.Store.Profile(r.Context(), ns)
	s.publishProfile(p, "image")
	writeJSON(w, http.StatusOK, map[string]any{"namespace": ns, "kind": kind, "url": u, "contentType": ct, "size": len(data), "profile": p})
}

func (p BrainProfile) keyOf(kind string) string {
	if kind == "cover" {
		return p.coverKey
	}
	return p.imageKey
}

// safeSegment keeps a namespace usable as one storage path segment.
func safeSegment(ns string) string {
	return strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || unicode.IsControl(r) {
			return '_'
		}
		return r
	}, strings.ReplaceAll(ns, "..", "__"))
}

func profileImageURL(ns, kind, tag string) string {
	return "/api/brain/profile/image/" + url.PathEscape(ns) + "/" + kind + "?v=" + tag
}

// DeleteProfileImage — DELETE /api/brain/profile/image?namespace=&kind=
func (s *Service) DeleteProfileImage(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	ns, kind := r.URL.Query().Get("namespace"), r.URL.Query().Get("kind")
	if kind == "" {
		kind = "image"
	}
	if !validKind(kind) {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "kind is image or cover"))
		return
	}
	if !s.canAdmin(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "only the brain's owner can change its images"))
		return
	}
	before, _ := s.Store.Profile(r.Context(), ns)
	if err := s.Store.setProfileImage(r.Context(), ns, kind, "", "", s.identify(r).agent); err != nil {
		writeErr(w, err)
		return
	}
	if old := before.keyOf(kind); old != "" {
		_ = s.blobs().Delete(old)
	}
	p, _ := s.Store.Profile(r.Context(), ns)
	s.publishProfile(p, "image")
	writeJSON(w, http.StatusOK, map[string]any{"namespace": ns, "kind": kind, "removed": true, "profile": p})
}

// ServeProfileImage — GET /api/brain/profile/image/{ns}/{kind}: members only.
func (s *Service) ServeProfileImage(w http.ResponseWriter, r *http.Request) {
	ns, _ := url.PathUnescape(chi.URLParam(r, "ns"))
	kind := chi.URLParam(r, "kind")
	if !validKind(kind) {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "no such image"))
		return
	}
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	p, err := s.Store.Profile(r.Context(), ns)
	key := p.keyOf(kind)
	if err != nil || key == "" {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "no image"))
		return
	}
	// The key embeds the content hash, so it is the ETag.
	etag := `"` + strings.TrimSuffix(filepath.Base(key), filepath.Ext(key)) + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Vary", "Cookie, Authorization")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, strings.Trim(etag, `"`)) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	data, err := s.blobs().Get(key)
	if err != nil {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "image missing from storage"))
		return
	}
	ct := sniffImage(data)
	if ct == "" {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "no image"))
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = w.Write(data)
}

// dropProfile removes a deleted brain's profile and its blobs.
func (s *Service) dropProfile(ctx context.Context, ns string) {
	for _, k := range s.Store.DeleteProfile(ctx, ns) {
		_ = s.blobs().Delete(k)
	}
}
