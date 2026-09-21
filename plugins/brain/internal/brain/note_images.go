package brain

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

/*
Inline images for note bodies — what the editor's paste-to-upload writes to.

This deliberately reuses profile.go's primitives (fsBlobs, sniffImage,
imageTypes, safeSegment) rather than growing a second storage path, but it
differs from profile images in three ways that matter:

  1. Blobs are CONTENT-ADDRESSED and carry no database row. A note image is
     referenced only by the markdown in the body, so there is nothing to keep
     in sync and pasting the same screenshot twice costs one blob. The flip
     side is that deleting a note does not reclaim its images; that needs a
     sweeper keyed on "no live note body references this digest", which is not
     written yet. See the note on orphans below.
  2. Writing needs write access, not admin. Any editor of a brain may paste an
     image into a note they can already edit; requiring admin (as profile
     images do) would make the feature useless for collaborators.
  3. The digest is the filename AND the identifier, so the serve route takes a
     hex digest rather than a caller-supplied name. That closes path traversal
     by construction: a 12-byte hex string cannot express "..".

SVG is rejected along with everything else outside PNG/JPEG/WebP. That is not
an oversight — an inline SVG is a script-execution vector, and these images are
rendered inside the app's own origin.
*/

// Notes hold screenshots and diagrams, which run larger than the 2 MB allowed
// for a brain's avatar, so this limit is its own constant rather than a reuse
// of maxImageBytes.
const maxNoteImageBytes = 8 << 20

// noteImageURL is the reference written into the markdown body. The digest is
// already in the path, so the URL is immutable and safe to cache hard.
func noteImageURL(ns, digest, ext string) string {
	return "/api/notes/image/" + url.PathEscape(ns) + "/" + digest + "." + ext
}

func noteImageKey(ns, digest, ext string) string {
	return "notes/" + safeSegment(ns) + "/" + digest + "." + ext
}

// isHexDigest guards the serve route: the path segment must be exactly the
// digest shape this package produces, so no caller-controlled string ever
// reaches the filesystem.
func isHexDigest(s string) bool {
	if len(s) != 12 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

// UploadNoteImage — POST /api/notes/image (multipart: namespace, file).
// Returns {url, digest, bytes, contentType} for the editor to splice into the body.
func (s *Service) UploadNoteImage(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxNoteImageBytes+(64<<10))
	if err := r.ParseMultipartForm(maxNoteImageBytes + (64 << 10)); err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiErr("too_large", "the image is at most 8 MB (multipart form expected)"))
		return
	}
	ns := strings.TrimSpace(r.FormValue("namespace"))
	if ns == "" {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required"))
		return
	}
	// Write access, not admin: collaborators paste images into notes they edit.
	if !s.canWrite(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+ns))
		return
	}

	f, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "file is required"))
		return
	}
	defer f.Close()

	// LimitReader one byte past the cap so an oversized upload is detected
	// rather than silently truncated to a corrupt image.
	data, err := io.ReadAll(io.LimitReader(f, maxNoteImageBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "could not read the file"))
		return
	}
	if len(data) > maxNoteImageBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiErr("too_large", "the image is at most 8 MB"))
		return
	}
	// Sniff the bytes; never trust the client's declared content type.
	ct := sniffImage(data)
	if ct == "" {
		writeJSON(w, http.StatusUnsupportedMediaType, apiErr("unsupported_type", "PNG, JPEG or WebP only (SVG is not accepted)"))
		return
	}

	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])[:12]
	ext := imageTypes[ct]
	// Content-addressed: re-pasting the same image overwrites itself byte for
	// byte, so Put is idempotent and needs no exists-check.
	if err := s.blobs().Put(noteImageKey(ns, digest, ext), data); err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"url":         noteImageURL(ns, digest, ext),
		"digest":      digest,
		"bytes":       len(data),
		"contentType": ct,
	})
}

// ServeNoteImage — GET /api/notes/image/{ns}/{name}: readers of the brain only.
func (s *Service) ServeNoteImage(w http.ResponseWriter, r *http.Request) {
	ns, _ := url.PathUnescape(chi.URLParam(r, "ns"))
	name := chi.URLParam(r, "name")

	ext := strings.TrimPrefix(filepath.Ext(name), ".")
	digest := strings.TrimSuffix(name, filepath.Ext(name))
	// Reject anything that is not exactly what UploadNoteImage produces.
	if !isHexDigest(digest) || (ext != "png" && ext != "jpg" && ext != "webp") {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "no such image"))
		return
	}
	// Images inherit the brain's read access: an unlisted blob URL is not a
	// capability, because the digest is guessable-adjacent and the body that
	// references it is itself access-controlled.
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	data, err := s.blobs().Get(noteImageKey(ns, digest, ext))
	if err != nil {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "image missing from storage"))
		return
	}
	// Re-sniff on the way out: a blob that is no longer a permitted image (a
	// bad restore, a tampered volume) must not be served as one.
	ct := sniffImage(data)
	if ct == "" {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "no image"))
		return
	}

	// The URL embeds the content hash, so the body can never change under a
	// given URL — immutable is honest here, unlike on the profile route.
	etag := `"` + digest + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Vary", "Cookie, Authorization")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, digest) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	_, _ = w.Write(data)
}
