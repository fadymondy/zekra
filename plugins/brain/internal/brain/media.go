package brain

/*
Media memories. A brain remembers more than text: an uploaded image, PDF, video
or audio file is read by the MediaReader (brain-ocr → zekra-ocr: PP-OCRv5 for any
script, keyframe OCR for video, whisper for speech) and its text becomes memory.

The text does not get its own pipeline. Each media file owns a companion NOTE
whose body embeds the file and carries the extracted text, one heading per page
/ keyframe time / transcript, so the ordinary note machinery does the rest:
chunking on those headings, retain (embed + BM25 + graph), versioning, deletion,
ACL and the editor. Recall therefore lands on the note, and the note shows the
media. The media row keeps only what a note cannot: the reader's status and the
raw result with line boxes and timestamps, for the viewer overlay.

Files are blobs in kernel storage under media/<ns>/<digest>.<ext>; the same file
uploaded twice into a brain is the same media (dedupe by sha256).
Reading runs in the background on a small worker pool; rows left pending or
processing by a restart are picked up again at boot.
*/

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
)

// mediaTypes maps an accepted content type to its kind and stored extension.
var mediaTypes = map[string]struct{ kind, ext string }{
	"image/png":        {"image", "png"},
	"image/jpeg":       {"image", "jpg"},
	"image/webp":       {"image", "webp"},
	"image/bmp":        {"image", "bmp"},
	"application/pdf":  {"pdf", "pdf"},
	"video/mp4":        {"video", "mp4"},
	"video/webm":       {"video", "webm"},
	"video/quicktime":  {"video", "mov"},
	"video/x-matroska": {"video", "mkv"},
	"video/avi":        {"video", "avi"},
	"audio/mpeg":       {"audio", "mp3"},
	"audio/wave":       {"audio", "wav"},
	"audio/ogg":        {"audio", "ogg"},
	"audio/mp4":        {"audio", "m4a"},
	"audio/webm":       {"audio", "weba"},
	"audio/aac":        {"audio", "aac"},
	"audio/flac":       {"audio", "flac"},
}

// Upload caps per kind (MB), overridable with MEDIA_MAX_<KIND>_MB.
var mediaDefaultMB = map[string]int64{"image": 40, "pdf": 200, "video": 1024, "audio": 512}

func mediaMaxBytes(kind string) int64 {
	mb := mediaDefaultMB[kind]
	if v, err := strconv.ParseInt(os.Getenv("MEDIA_MAX_"+strings.ToUpper(kind)+"_MB"), 10, 64); err == nil && v > 0 {
		mb = v
	}
	return mb << 20
}

func mediaUploadCap() int64 {
	var m int64
	for k := range mediaDefaultMB {
		if b := mediaMaxBytes(k); b > m {
			m = b
		}
	}
	return m
}

// sniffMedia names the type from the bytes. Containers the stdlib sniffer does
// not know (QuickTime, Matroska, m4a, flac, aac) fall back to the declared type
// or the file extension, but only within the accepted set; the reader's ffmpeg
// rejects anything that is not really media.
func sniffMedia(data []byte, declared, name string) string {
	ct := http.DetectContentType(data)
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	switch ct {
	case "application/ogg":
		ct = "audio/ogg"
	case "audio/wav", "audio/x-wav":
		ct = "audio/wave"
	}
	if _, ok := mediaTypes[ct]; ok {
		// The stdlib reads any ISO-BMFF "ftyp" box as video/mp4; m4a is audio.
		if ct == "video/mp4" && len(data) > 11 && string(data[8:11]) == "M4A" {
			return "audio/mp4"
		}
		return ct
	}
	if ct != "application/octet-stream" {
		return ""
	}
	if i := strings.IndexByte(declared, ';'); i >= 0 {
		declared = declared[:i]
	}
	if t, ok := mediaTypes[strings.TrimSpace(declared)]; ok && t.kind != "image" && t.kind != "pdf" {
		return strings.TrimSpace(declared)
	}
	byExt := map[string]string{".mov": "video/quicktime", ".mkv": "video/x-matroska", ".m4a": "audio/mp4",
		".flac": "audio/flac", ".aac": "audio/aac", ".weba": "audio/webm"}
	return byExt[strings.ToLower(filepath.Ext(name))]
}

// Media is one uploaded file.
type Media struct {
	ID          string     `json:"id"`
	Namespace   string     `json:"namespace"`
	NoteID      string     `json:"noteId,omitempty"`
	Kind        string     `json:"kind"`
	Name        string     `json:"name"`
	ContentType string     `json:"contentType"`
	Bytes       int64      `json:"bytes"`
	Digest      string     `json:"digest"`
	Status      string     `json:"status"`
	Error       string     `json:"error,omitempty"`
	Result      *MediaText `json:"result,omitempty"`
	URL         string     `json:"url"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`

	blobKey string
	owner   string
}

const mediaCols = `id, namespace, coalesce(note_id::text,''), kind, name, content_type, bytes, digest, status,
	coalesce(error,''), result, created_at, updated_at, blob_key, coalesce(owner_user_id,'')`

func scanMedia(row interface{ Scan(...any) error }, withResult bool) (*Media, error) {
	m := &Media{}
	var res []byte
	if err := row.Scan(&m.ID, &m.Namespace, &m.NoteID, &m.Kind, &m.Name, &m.ContentType, &m.Bytes, &m.Digest,
		&m.Status, &m.Error, &res, &m.CreatedAt, &m.UpdatedAt, &m.blobKey, &m.owner); err != nil {
		return nil, err
	}
	if withResult && len(res) > 0 {
		m.Result = &MediaText{}
		_ = json.Unmarshal(res, m.Result)
	}
	m.URL = "/api/brain/media/" + m.ID + "/file"
	return m, nil
}

func (s *Store) mediaReader() MediaReader {
	v, _ := s.k.Get(keyMediaReader)
	m, _ := v.(MediaReader)
	return m
}

// GetMedia loads one media row (with its result).
func (s *Store) GetMedia(ctx context.Context, id string) (*Media, error) {
	if !uuidRE.MatchString(id) {
		return nil, ErrNotFound
	}
	db, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	m, err := scanMedia(db.QueryRowContext(ctx, `SELECT `+mediaCols+` FROM brain_media WHERE id=$1 AND deleted_at IS NULL`, id), true)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ListMedia lists a brain's media, newest first, optionally of one kind or one note.
func (s *Store) ListMedia(ctx context.Context, ns, kind, noteID string, limit, offset int) ([]*Media, int, error) {
	db, err := s.db(ctx)
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	where := `namespace=$1 AND deleted_at IS NULL AND ($2='' OR kind=$2) AND ($3='' OR note_id::text=$3)`
	var total int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM brain_media WHERE `+where, ns, kind, noteID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.QueryContext(ctx, `SELECT `+mediaCols+` FROM brain_media WHERE `+where+`
		ORDER BY created_at DESC, id LIMIT $4 OFFSET $5`, ns, kind, noteID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []*Media{}
	for rows.Next() {
		m, err := scanMedia(rows, false)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, m)
	}
	return out, total, rows.Err()
}

func (s *Store) setMediaStatus(ctx context.Context, id, status, msg string, res *MediaText) error {
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	var raw any
	if res != nil {
		b, _ := json.Marshal(res)
		raw = b
	}
	_, err = db.ExecContext(ctx, `UPDATE brain_media SET status=$2, error=nullif($3,''), result=coalesce($4::jsonb, result),
		updated_at=now() WHERE id=$1`, id, status, msg, raw)
	return err
}

// --- note body -----------------------------------------------------------------

func clock(sec float64) string {
	t := int(sec + 0.5)
	if t >= 3600 {
		return fmt.Sprintf("%d:%02d:%02d", t/3600, t/60%60, t%60)
	}
	return fmt.Sprintf("%d:%02d", t/60, t%60)
}

// mediaNoteBody is the companion note: the embedded file, then the text under
// one heading per page / keyframe, then the transcript. Headings are where the
// note chunker splits, so a recall hit points at the right page or moment.
func mediaNoteBody(m *Media, res *MediaText, status string) string {
	var b strings.Builder
	if m.Kind == "image" {
		fmt.Fprintf(&b, "![%s](%s)\n\n", mdEscape(m.Name), m.URL)
	} else {
		fmt.Fprintf(&b, "[%s](%s)\n\n", mdEscape(m.Name), m.URL)
	}
	if res == nil {
		b.WriteString("_" + status + "_\n")
		return b.String()
	}
	var speech []MediaSegment
	wrote := false
	for _, sg := range res.Segments {
		text := strings.TrimSpace(sg.Text)
		if text == "" {
			continue
		}
		switch sg.Kind {
		case "speech":
			speech = append(speech, sg)
			continue
		case "page":
			fmt.Fprintf(&b, "## Page %d\n\n", sg.Page)
		case "frame":
			if sg.Start != nil {
				fmt.Fprintf(&b, "## Frame at %s\n\n", clock(*sg.Start))
			} else {
				b.WriteString("## Frame\n\n")
			}
		default:
			b.WriteString("## Text in image\n\n")
		}
		b.WriteString(text + "\n\n")
		wrote = true
	}
	if len(speech) > 0 {
		b.WriteString("## Transcript\n\n")
		for _, sg := range speech {
			if sg.Start != nil {
				fmt.Fprintf(&b, "[%s] ", clock(*sg.Start))
			}
			b.WriteString(strings.TrimSpace(sg.Text) + "\n\n")
		}
		wrote = true
	}
	if !wrote {
		b.WriteString("_No text found._\n")
	}
	out := b.String()
	if len(out) > noteMaxBody {
		out = out[:noteMaxBody-64] + "\n\n_…truncated._\n"
	}
	return out
}

func mdEscape(s string) string {
	return strings.NewReplacer("[", "\\[", "]", "\\]", "\n", " ").Replace(s)
}

// --- processing ------------------------------------------------------------------

type mediaWorkers struct {
	once sync.Once
	sem  chan struct{}
}

var mediaPool mediaWorkers

func (s *Service) mediaSem() chan struct{} {
	mediaPool.once.Do(func() {
		n, _ := strconv.Atoi(os.Getenv("MEDIA_WORKERS"))
		if n <= 0 {
			n = 2
		}
		mediaPool.sem = make(chan struct{}, n)
	})
	return mediaPool.sem
}

// enqueueMedia reads a media file in the background.
func (s *Service) enqueueMedia(id string) {
	go func() {
		sem := s.mediaSem()
		sem <- struct{}{}
		defer func() { <-sem }()
		s.processMedia(id)
	}()
}

func (s *Service) processMedia(id string) {
	timeout := 30 * time.Minute
	if v, err := time.ParseDuration(os.Getenv("MEDIA_READ_TIMEOUT")); err == nil && v > 0 {
		timeout = v
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	log := func(msg string, err error) {
		if s.k != nil && s.k.Log != nil {
			s.k.Log.Warn(msg, "media", id, "err", err)
		}
	}

	m, err := s.Store.GetMedia(ctx, id)
	if err != nil {
		log("media: load", err)
		return
	}
	reader := s.Store.mediaReader()
	if reader == nil {
		_ = s.Store.setMediaStatus(ctx, id, "failed", "no media reader is configured (set OCR_URL)", nil)
		return
	}
	_ = s.Store.setMediaStatus(ctx, id, "processing", "", nil)
	s.publishMedia("processing", m)

	data, err := s.blobs().Get(m.blobKey)
	if err != nil {
		_ = s.Store.setMediaStatus(ctx, id, "failed", "the file is missing from storage", nil)
		log("media: blob", err)
		return
	}
	res, err := reader.ReadMedia(ctx, m.Kind, m.Name, data)
	if err != nil {
		_ = s.Store.setMediaStatus(ctx, id, "failed", err.Error(), nil)
		s.publishMedia("failed", m)
		log("media: read", err)
		return
	}
	if m.NoteID != "" {
		body := mediaNoteBody(m, res, "")
		by := NoteAuthor{UserID: m.owner, Source: "api"}
		if _, err := s.Store.UpdateNote(ctx, m.NoteID, 0, NotePatch{Body: &body}, by); err != nil && !errors.Is(err, ErrNotFound) {
			_ = s.Store.setMediaStatus(ctx, id, "failed", "indexing: "+err.Error(), res)
			log("media: note", err)
			return
		}
	}
	_ = s.Store.setMediaStatus(ctx, id, "done", "", res)
	s.publishMedia("done", m)
}

// resumeMedia re-queues rows a restart interrupted.
func (s *Service) resumeMedia() {
	time.Sleep(10 * time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := s.Store.db(ctx)
	if err != nil {
		return
	}
	rows, err := db.QueryContext(ctx, `SELECT id FROM brain_media WHERE status IN ('pending','processing') AND deleted_at IS NULL
		ORDER BY created_at LIMIT 500`)
	if err != nil {
		return // table not migrated yet
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			s.enqueueMedia(id)
		}
	}
}

func (s *Service) publishMedia(action string, m *Media) {
	if s.hub == nil {
		return
	}
	s.hub.publish("media", map[string]any{"action": action, "id": m.ID, "namespace": m.Namespace, "noteId": m.NoteID})
}

// --- HTTP ------------------------------------------------------------------------

func (s *Service) mountMedia(r chi.Router, sec func(http.HandlerFunc) http.HandlerFunc) {
	r.Post("/api/brain/media", sec(s.UploadMedia))
	r.Get("/api/brain/media", sec(s.ListMediaH))
	r.Get("/api/brain/media/live", sec(s.LiveMedia))
	r.Get("/api/brain/media/{id}", sec(s.GetMediaH))
	r.Get("/api/brain/media/{id}/file", sec(s.ServeMedia))
	r.Post("/api/brain/media/{id}/reprocess", sec(s.ReprocessMedia))
	r.Delete("/api/brain/media/{id}", sec(s.DeleteMedia))
	go s.resumeMedia()
}

// UploadMedia — POST /api/brain/media. Multipart (namespace, file, title?) from the
// console, or JSON {namespace, title?, filename?, data (base64) | url} from
// agents (media_retain). Stores the file, creates its note and starts reading
// it. 201 with the media; 200 with the existing one when this brain already has
// the same file.
func (s *Service) UploadMedia(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	limit := mediaUploadCap()
	var ns, title, filename, declared string
	var data []byte
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		r.Body = http.MaxBytesReader(w, r.Body, limit*4/3+(1<<20))
		var in struct{ Namespace, Title, Filename, Data, URL string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "invalid JSON body (or the file is too large)"))
			return
		}
		ns, title, filename = strings.TrimSpace(in.Namespace), in.Title, in.Filename
		if ns == "" || !s.canWrite(r, ns) {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+ns))
			return
		}
		switch {
		case in.Data != "":
			b, err := base64.StdEncoding.DecodeString(stripDataURL(in.Data))
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "data must be base64"))
				return
			}
			data = b
		case in.URL != "":
			b, ct, name, err := fetchPublic(r.Context(), in.URL, limit)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "could not fetch url: "+err.Error()))
				return
			}
			data, declared = b, ct
			if filename == "" {
				filename = name
			}
		default:
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "data or url is required"))
			return
		}
	} else {
		r.Body = http.MaxBytesReader(w, r.Body, limit+(1<<20))
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeJSON(w, http.StatusRequestEntityTooLarge, apiErr("too_large", "the file is too large (multipart form expected)"))
			return
		}
		defer r.MultipartForm.RemoveAll()
		ns, title = strings.TrimSpace(r.FormValue("namespace")), r.FormValue("title")
		if ns == "" {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "namespace is required"))
			return
		}
		if !s.canWrite(r, ns) {
			writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no write access to brain "+ns))
			return
		}
		f, hdr, err := r.FormFile("file")
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "file is required"))
			return
		}
		defer f.Close()
		if data, err = io.ReadAll(io.LimitReader(f, limit+1)); err != nil {
			writeJSON(w, http.StatusBadRequest, apiErr("invalid_argument", "could not read the file"))
			return
		}
		filename, declared = hdr.Filename, hdr.Header.Get("Content-Type")
	}
	ct := sniffMedia(data, declared, filename)
	t, ok := mediaTypes[ct]
	if !ok {
		writeJSON(w, http.StatusUnsupportedMediaType, apiErr("unsupported_type",
			"images (PNG, JPEG, WebP, BMP), PDF, video (MP4, WebM, MOV, MKV) or audio (MP3, WAV, OGG, M4A, FLAC)"))
		return
	}
	if max := mediaMaxBytes(t.kind); int64(len(data)) > max {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiErr("too_large", fmt.Sprintf("a %s is at most %d MB", t.kind, max>>20)))
		return
	}

	sum := sha256.Sum256(data)
	digest := hex.EncodeToString(sum[:])
	ctx := r.Context()
	db, err := s.Store.db(ctx)
	if err != nil {
		writeErr(w, err)
		return
	}
	if m, err := scanMedia(db.QueryRowContext(ctx, `SELECT `+mediaCols+` FROM brain_media
		WHERE namespace=$1 AND digest=$2 AND deleted_at IS NULL LIMIT 1`, ns, digest), true); err == nil {
		writeJSON(w, http.StatusOK, m)
		return
	}

	key := fmt.Sprintf("media/%s/%s.%s", safeSegment(ns), digest[:32], t.ext)
	if err := s.blobs().Put(key, data); err != nil {
		writeErr(w, err)
		return
	}
	name := filepath.Base(strings.ReplaceAll(strings.TrimSpace(filename), "\\", "/"))
	if name == "." || name == "/" || name == "" {
		name = t.kind + "." + t.ext
	}
	if title = strings.TrimSpace(title); title == "" {
		title = strings.TrimSuffix(name, filepath.Ext(name))
	}
	if r := []rune(title); len(r) > noteMaxTitle {
		title = string(r[:noteMaxTitle])
	}
	source := "web"
	if isCamera(r) {
		source = "mobile"
	}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		source = "agent"
	}
	author := s.noteAuthor(r, source)

	m := &Media{Namespace: ns, Kind: t.kind, Name: name, ContentType: ct, Bytes: int64(len(data)), Digest: digest, blobKey: key, owner: author.UserID}
	if err := db.QueryRowContext(ctx, `INSERT INTO brain_media (namespace, owner_user_id, kind, name, content_type, bytes, digest, blob_key)
		VALUES ($1, nullif($2,''), $3, $4, $5, $6, $7, $8) RETURNING id, status, created_at, updated_at`,
		ns, author.UserID, t.kind, name, ct, m.Bytes, digest, key).Scan(&m.ID, &m.Status, &m.CreatedAt, &m.UpdatedAt); err != nil {
		writeErr(w, err)
		return
	}
	m.URL = "/api/brain/media/" + m.ID + "/file"

	note, err := s.Store.CreateNote(ctx, NoteInput{
		Namespace: ns, Title: title, Body: mediaNoteBody(m, nil, "Reading…"),
		Tags: []string{"media", t.kind}, Category: "media",
	}, author)
	if err != nil {
		_, _ = db.ExecContext(ctx, `UPDATE brain_media SET deleted_at=now() WHERE id=$1`, m.ID)
		writeErr(w, err)
		return
	}
	m.NoteID = note.ID
	if _, err := db.ExecContext(ctx, `UPDATE brain_media SET note_id=$2 WHERE id=$1`, m.ID, note.ID); err != nil {
		writeErr(w, err)
		return
	}
	s.publishNote("created", note)
	s.enqueueMedia(m.ID)
	writeJSON(w, http.StatusCreated, m)
}

// ListMediaH — GET /api/brain/media?namespace=&kind=&note=&limit=&offset=.
func (s *Service) ListMediaH(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	ns := q.Get("namespace")
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	items, total, err := s.Store.ListMedia(r.Context(), ns, q.Get("kind"), q.Get("note"), limit, offset)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "reader": s.Store.mediaReader() != nil})
}

func (s *Service) mediaFor(w http.ResponseWriter, r *http.Request, write bool) (*Media, bool) {
	m, err := s.Store.GetMedia(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, err)
		return nil, false
	}
	allowed := s.canRead(r, m.Namespace)
	if write {
		allowed = s.canWrite(r, m.Namespace)
	}
	if !allowed {
		// Same answer as a missing id, so ids do not leak across brains.
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "brain: not found"))
		return nil, false
	}
	return m, true
}

// GetMediaH — GET /api/brain/media/{id}: the row with its reader result (line boxes, times).
func (s *Service) GetMediaH(w http.ResponseWriter, r *http.Request) {
	if m, ok := s.mediaFor(w, r, false); ok {
		writeJSON(w, http.StatusOK, m)
	}
}

// ServeMedia — GET /api/brain/media/{id}/file: the file, with Range support so video seeks.
func (s *Service) ServeMedia(w http.ResponseWriter, r *http.Request) {
	m, ok := s.mediaFor(w, r, false)
	if !ok {
		return
	}
	data, err := s.blobs().Get(m.blobKey)
	if err != nil {
		writeJSON(w, http.StatusNotFound, apiErr("not_found", "the file is missing"))
		return
	}
	w.Header().Set("Content-Type", m.ContentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", m.Name))
	w.Header().Set("ETag", `"`+m.Digest[:32]+`"`)
	http.ServeContent(w, r, "", m.CreatedAt, bytes.NewReader(data))
}

// ReprocessMedia — POST /api/brain/media/{id}/reprocess: read the file again.
func (s *Service) ReprocessMedia(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	m, ok := s.mediaFor(w, r, true)
	if !ok {
		return
	}
	if err := s.Store.setMediaStatus(r.Context(), m.ID, "pending", "", nil); err != nil {
		writeErr(w, err)
		return
	}
	s.enqueueMedia(m.ID)
	m.Status, m.Error = "pending", ""
	writeJSON(w, http.StatusAccepted, m)
}

// DeleteMedia — DELETE /api/brain/media/{id}: tombstones the media and deletes its note
// (which invalidates the note's memories). The blob stays: another brain may
// hold the same file under the same key only if it is the same namespace, so it
// is removed once no live row references it.
func (s *Service) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	if !s.noteWriteGuard(w, r) {
		return
	}
	m, ok := s.mediaFor(w, r, true)
	if !ok {
		return
	}
	ctx := r.Context()
	if m.NoteID != "" {
		if _, err := s.Store.DeleteNote(ctx, m.NoteID, 0, s.noteAuthor(r, "web")); err != nil && !errors.Is(err, ErrNotFound) {
			writeErr(w, err)
			return
		}
	}
	db, err := s.Store.db(ctx)
	if err != nil {
		writeErr(w, err)
		return
	}
	if _, err := db.ExecContext(ctx, `UPDATE brain_media SET deleted_at=now(), updated_at=now() WHERE id=$1`, m.ID); err != nil {
		writeErr(w, err)
		return
	}
	var live int
	_ = db.QueryRowContext(ctx, `SELECT count(*) FROM brain_media WHERE blob_key=$1 AND deleted_at IS NULL`, m.blobKey).Scan(&live)
	if live == 0 {
		_ = s.blobs().Delete(m.blobKey)
	}
	s.publishMedia("deleted", m)
	w.WriteHeader(http.StatusNoContent)
}

// LiveMedia — GET /api/brain/media/live?namespace= (websocket): camera mode. The
// browser streams JPEG frames and gets OCR lines back; the socket is passed
// through to the reader's live endpoint, which carries the reader token, so
// the token never reaches the browser. Saving a moment is an ordinary upload.
func (s *Service) LiveMedia(w http.ResponseWriter, r *http.Request) {
	ns := r.URL.Query().Get("namespace")
	if !s.canRead(r, ns) {
		writeJSON(w, http.StatusForbidden, apiErr("permission_denied", "no read access to brain "+ns))
		return
	}
	reader := s.Store.mediaReader()
	if reader == nil || reader.LiveURL() == "" {
		writeJSON(w, http.StatusServiceUnavailable, apiErr("unavailable", "live reading is not configured (set OCR_URL)"))
		return
	}
	target, err := url.Parse(reader.LiveURL())
	if err != nil {
		writeErr(w, err)
		return
	}
	switch target.Scheme {
	case "ws":
		target.Scheme = "http"
	case "wss":
		target.Scheme = "https"
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = target
			pr.Out.Host = target.Host
			pr.Out.Header.Del("Cookie")
			pr.Out.Header.Del("Authorization")
			pr.Out.Header.Del("Origin")
		},
	}
	proxy.ServeHTTP(w, r)
}

// stripDataURL drops a "data:<type>;base64," prefix agents often include.
func stripDataURL(s string) string {
	if strings.HasPrefix(s, "data:") {
		if i := strings.Index(s, ","); i >= 0 {
			return s[i+1:]
		}
	}
	return s
}

// fetchPublic downloads an agent-supplied URL. Only http(s), and the dialer
// refuses loopback, private, link-local and unspecified addresses — checked on
// the resolved IP at connect time, so redirects and DNS rebinding cannot reach
// the internal network.
func fetchPublic(ctx context.Context, raw string, limit int64) ([]byte, string, string, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, "", "", errors.New("only http(s) URLs")
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return err
		}
		ip := net.ParseIP(host)
		if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
			ip.IsUnspecified() || ip.IsMulticast() {
			return errors.New("address not allowed")
		}
		return nil
	}}
	client := &http.Client{Timeout: 5 * time.Minute, Transport: &http.Transport{
		DialContext: dialer.DialContext, TLSHandshakeTimeout: 10 * time.Second, Proxy: nil}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "", "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, "", "", errors.New(resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, "", "", err
	}
	if int64(len(data)) > limit {
		return nil, "", "", errors.New("file too large")
	}
	return data, resp.Header.Get("Content-Type"), path.Base(resp.Request.URL.Path), nil
}
