package brain

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// uploadNoteImage posts a multipart image to the note-image route as a session
// user (with the CSRF pair), mirroring profile_test.go's upload helper.
func (f *fix) uploadNoteImage(user, ns, filename string, data []byte) *httptest.ResponseRecorder {
	f.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("namespace", ns)
	fw, _ := mw.CreateFormFile("file", filename)
	_, _ = fw.Write(data)
	_ = mw.Close()
	hr := httptest.NewRequest("POST", "/api/notes/image", &body)
	hr.Header.Set("Content-Type", mw.FormDataContentType())
	hr.Header.Set("X-Test-User", user)
	hr.AddCookie(&http.Cookie{Name: "togo_csrf", Value: "c"})
	hr.Header.Set("X-CSRF-Token", "c")
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, hr)
	return rec
}

func setupNoteImageBrain(t *testing.T) (*fix, string) {
	t.Setenv("STORAGE_DIR", t.TempDir())
	f := newFix(t)
	ns := f.ns("noteimg")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-bob','editor'), ($1,'u-carol','viewer')`, ns)
	f.dir.mu.Lock()
	f.dir.users["u-dave"] = []string{"member"} // signed in, not a member
	f.dir.mu.Unlock()
	return f, ns
}

// An editor (not just the owner) must be able to paste an image, and the
// returned URL must serve the exact bytes back.
func TestNoteImageUploadAndServeRoundTrip(t *testing.T) {
	f, ns := setupNoteImageBrain(t)
	png := tinyPNG(t)

	rec := f.uploadNoteImage("u-bob", ns, "paste.png", png)
	if rec.Code != 200 {
		t.Fatalf("editor upload: %d %s", rec.Code, rec.Body.String())
	}
	out := decodeMap(t, rec)
	url, _ := out["url"].(string)
	if url == "" {
		t.Fatalf("no url in %v", out)
	}
	if out["contentType"] != "image/png" {
		t.Errorf("contentType = %v, want image/png", out["contentType"])
	}

	got := f.do(req{method: "GET", path: url, user: "u-carol"}) // viewer may read
	if got.Code != 200 {
		t.Fatalf("viewer serve: %d %s", got.Code, got.Body.String())
	}
	if !bytes.Equal(got.Body.Bytes(), png) {
		t.Errorf("served bytes differ from uploaded (%d vs %d)", got.Body.Len(), len(png))
	}
	if ct := got.Header().Get("Content-Type"); ct != "image/png" {
		t.Errorf("Content-Type = %q", ct)
	}
	// Serving user content from our own origin without these is how a stored
	// image becomes a stored XSS.
	if got.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Error("missing nosniff")
	}
	if got.Header().Get("Content-Security-Policy") == "" {
		t.Error("missing CSP on served image")
	}
}

// Content addressing: the same bytes must collapse to one URL.
func TestNoteImageIsContentAddressed(t *testing.T) {
	f, ns := setupNoteImageBrain(t)
	png := tinyPNG(t)

	a := decodeMap(t, f.uploadNoteImage("u-alice", ns, "one.png", png))
	b := decodeMap(t, f.uploadNoteImage("u-alice", ns, "two.png", png))
	if a["url"] != b["url"] {
		t.Errorf("same bytes gave different urls: %v vs %v", a["url"], b["url"])
	}
}

// THE POINT OF THIS TEST: /api/notes/image and /api/notes/{id} overlap, and if
// chi resolved the param route first, every image GET would land in GetNote
// with id="image" and quietly 404 (or worse, leak a note). Prove the static
// segment wins.
func TestNoteImageRouteBeatsNoteIDRoute(t *testing.T) {
	f, ns := setupNoteImageBrain(t)
	out := decodeMap(t, f.uploadNoteImage("u-alice", ns, "x.png", tinyPNG(t)))
	url, _ := out["url"].(string)

	rec := f.do(req{method: "GET", path: url, user: "u-alice"})
	if rec.Code != 200 {
		t.Fatalf("image url did not reach ServeNoteImage: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/png" {
		t.Fatalf("got %q — this looks like GetNote answered instead", ct)
	}
}

func TestNoteImageAccessControl(t *testing.T) {
	f, ns := setupNoteImageBrain(t)
	png := tinyPNG(t)

	// A viewer may read but must not write.
	if rec := f.uploadNoteImage("u-carol", ns, "v.png", png); rec.Code != 403 {
		t.Errorf("viewer upload = %d, want 403", rec.Code)
	}
	// A signed-in non-member gets nothing either way.
	if rec := f.uploadNoteImage("u-dave", ns, "d.png", png); rec.Code != 403 {
		t.Errorf("non-member upload = %d, want 403", rec.Code)
	}
	url, _ := decodeMap(t, f.uploadNoteImage("u-alice", ns, "o.png", png))["url"].(string)
	if rec := f.do(req{method: "GET", path: url, user: "u-dave"}); rec.Code != 403 {
		t.Errorf("non-member serve = %d, want 403", rec.Code)
	}
}

// SVG is the one that matters: it executes script in our origin.
func TestNoteImageRejectsNonRaster(t *testing.T) {
	f, ns := setupNoteImageBrain(t)
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	if rec := f.uploadNoteImage("u-alice", ns, "x.svg", svg); rec.Code != 415 {
		t.Errorf("svg upload = %d, want 415", rec.Code)
	}
	if rec := f.uploadNoteImage("u-alice", ns, "x.txt", []byte("just text")); rec.Code != 415 {
		t.Errorf("text upload = %d, want 415", rec.Code)
	}
}

// The serve route must refuse anything that is not the digest shape it emits,
// so a caller-supplied name can never reach the filesystem.
func TestNoteImageServeRejectsBadNames(t *testing.T) {
	f, ns := setupNoteImageBrain(t)
	for _, name := range []string{
		"..%2f..%2fetc%2fpasswd.png",
		"nothex.png",
		"abcdef123456.svg",  // right digest shape, disallowed extension
		"abcdef1234567.png", // 13 chars
		"abcdef12345.png",   // 11 chars
	} {
		rec := f.do(req{method: "GET", path: "/api/notes/image/" + ns + "/" + name, user: "u-alice"})
		if rec.Code != 404 {
			t.Errorf("serve %q = %d, want 404", name, rec.Code)
		}
	}
}
