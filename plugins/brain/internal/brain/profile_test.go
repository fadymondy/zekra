package brain

import (
	"bytes"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// upload posts a multipart image as a session user (with the CSRF pair).
func (f *fix) upload(user, ns, kind, filename string, data []byte) *httptest.ResponseRecorder {
	f.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	_ = mw.WriteField("namespace", ns)
	_ = mw.WriteField("kind", kind)
	fw, _ := mw.CreateFormFile("file", filename)
	_, _ = fw.Write(data)
	_ = mw.Close()
	hr := httptest.NewRequest("POST", "/api/brain/profile/image", &body)
	hr.Header.Set("Content-Type", mw.FormDataContentType())
	hr.Header.Set("X-Test-User", user)
	hr.AddCookie(&http.Cookie{Name: "togo_csrf", Value: "c"})
	hr.Header.Set("X-CSRF-Token", "c")
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, hr)
	return rec
}

func profileOf(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	p, _ := decodeMap(t, rec)["profile"].(map[string]any)
	if p == nil {
		t.Fatalf("no profile in %d %s", rec.Code, rec.Body.String())
	}
	return p
}

func setupProfileBrain(t *testing.T) (*fix, string) {
	t.Setenv("STORAGE_DIR", t.TempDir())
	f := newFix(t)
	ns := f.ns("prof")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-bob','editor'), ($1,'u-carol','viewer')`, ns)
	f.dir.mu.Lock()
	f.dir.users["u-dave"] = []string{"member"} // signed in, not a member
	f.dir.mu.Unlock()
	return f, ns
}

func TestProfileDefaults(t *testing.T) {
	f, ns := setupProfileBrain(t)
	rec := f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: "u-carol"})
	if rec.Code != 200 {
		t.Fatalf("viewer get: %d %s", rec.Code, rec.Body.String())
	}
	p := profileOf(t, rec)
	if p["displayName"] != ns || p["persisted"] != false || p["color"] != defaultColor(ns) ||
		p["colorHex"] != colorHex(defaultColor(ns)) || p["visibility"] != "private" {
		t.Errorf("defaults: %v", p)
	}
	if e := decodeMap(t, rec)["edit"]; e != "none" {
		t.Errorf("viewer edit level = %v", e)
	}
	for user, want := range map[string]string{"u-alice": "full", "u-admin": "full", "u-bob": "limited"} {
		if e := decodeMap(t, f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: user}))["edit"]; e != want {
			t.Errorf("%s edit = %v, want %s", user, e, want)
		}
	}
	for _, user := range []string{"u-dave", ""} {
		if rec := f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: user}); rec.Code != 403 {
			t.Errorf("get as %q: %d", user, rec.Code)
		}
	}
	// The palette pick is deterministic.
	if defaultColor("flowos") != defaultColor("flowos") || colorHex(defaultColor("flowos")) == "" {
		t.Error("defaultColor not stable")
	}
}

func TestProfilePatchValidation(t *testing.T) {
	f, ns := setupProfileBrain(t)
	bad := []map[string]any{
		{"color": "#12345"}, {"color": "chartreuse"}, {"color": "red; background:url(x)"},
		{"displayName": strings.Repeat("x", 81)}, {"displayName": "a\x00b"},
		{"description": strings.Repeat("d", 2001)},
		{"icon": strings.Repeat("i", 33)},
		{"imageUrl": "javascript:alert(1)"}, {"coverUrl": "ftp://x/y.png"}, {"imageUrl": "https://user:pw@x/y.png"},
		{"visibility": "public"},
		{"defaultNoteCategory": "Not A Category!!"},
		{"settings": []int{1}},
	}
	for _, b := range bad {
		b["namespace"] = ns
		if rec := f.do(req{method: "PATCH", path: "/api/brain/profile", user: "u-alice", body: b}); rec.Code != 400 {
			t.Errorf("patch %v: %d %s", b, rec.Code, rec.Body.String())
		}
	}
	rec := f.do(req{method: "PATCH", path: "/api/brain/profile", user: "u-alice", body: map[string]any{
		"namespace": ns, "displayName": "  Product Brain ", "color": "#AABBCC", "icon": "🧠", "description": "line 1\nline 2",
		"imageUrl": "https://example.com/a.png", "visibility": "internal", "defaultNoteCategory": "decision",
		"settings": map[string]any{"pinned": true},
	}})
	if rec.Code != 200 {
		t.Fatalf("valid patch: %d %s", rec.Code, rec.Body.String())
	}
	p := profileOf(t, rec)
	if p["displayName"] != "Product Brain" || p["color"] != "#aabbcc" || p["colorHex"] != "#aabbcc" || p["icon"] != "🧠" ||
		p["visibility"] != "internal" || p["defaultNoteCategory"] != "decision" || p["persisted"] != true ||
		p["imageUrl"] != "https://example.com/a.png" || p["updatedBy"] != "user:u-alice" || p["description"] != "line 1\nline 2" {
		t.Errorf("patched: %v", p)
	}
	// "" resets the colour to the default; other fields are untouched.
	p = profileOf(t, f.do(req{method: "PATCH", path: "/api/brain/profile", user: "u-alice", body: map[string]any{"namespace": ns, "color": ""}}))
	if p["color"] != defaultColor(ns) || p["displayName"] != "Product Brain" {
		t.Errorf("reset colour: %v", p)
	}
	// Lists carry the profile.
	mine := decodeMap(t, f.do(req{method: "GET", path: "/api/brain/mine", user: "u-alice"}))
	found := false
	for _, b := range mine["brains"].([]any) {
		if m := b.(map[string]any); m["namespace"] == ns {
			found = m["displayName"] == "Product Brain" && m["icon"] == "🧠" && m["colorHex"] != ""
		}
	}
	if !found {
		t.Errorf("/mine lacks the profile: %v", mine)
	}
	// The default note category applies to new notes that name none.
	rec = f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: map[string]any{"namespace": ns, "title": "t"}})
	if n := decodeMap(t, rec); n["category"] != "decision" {
		t.Errorf("note category = %v (%d %s)", n["category"], rec.Code, rec.Body.String())
	}
}

func TestProfileCreateBrainWithProfile(t *testing.T) {
	f, _ := setupProfileBrain(t)
	ns := f.ns("fresh")
	rec := f.do(req{method: "POST", path: "/api/brain/brains", user: "u-alice", body: map[string]any{"namespace": ns, "color": "nope"}})
	if rec.Code != 400 {
		t.Fatalf("invalid colour on create: %d", rec.Code)
	}
	if n := f.count(`SELECT count(*) FROM brain_members WHERE namespace=$1`, ns); n != 0 {
		t.Fatalf("brain claimed despite a bad profile")
	}
	rec = f.do(req{method: "POST", path: "/api/brain/brains", user: "u-alice", body: map[string]any{
		"namespace": ns, "displayName": "Fresh", "color": "violet", "description": "new"}})
	if rec.Code != 201 {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	p := profileOf(t, f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: "u-alice"}))
	if p["displayName"] != "Fresh" || p["color"] != "violet" || p["description"] != "new" {
		t.Errorf("created profile: %v", p)
	}
}

func TestProfileAccess(t *testing.T) {
	f, ns := setupProfileBrain(t)
	patch := func(user string, b map[string]any) int {
		b["namespace"] = ns
		return f.do(req{method: "PATCH", path: "/api/brain/profile", user: user, body: b}).Code
	}
	if c := patch("u-carol", map[string]any{"description": "x"}); c != 403 {
		t.Errorf("viewer patch: %d", c)
	}
	if c := patch("u-dave", map[string]any{"description": "x"}); c != 403 {
		t.Errorf("outsider patch: %d", c)
	}
	if c := patch("u-bob", map[string]any{"description": "by the editor", "color": "teal"}); c != 200 {
		t.Errorf("editor description+color: %d", c)
	}
	for _, b := range []map[string]any{{"displayName": "x"}, {"icon": "x"}, {"visibility": "internal"},
		{"defaultNoteCategory": "idea"}, {"imageUrl": ""}, {"description": "y", "displayName": "z"}} {
		if c := patch("u-bob", b); c != 403 {
			t.Errorf("editor %v: %d", b, c)
		}
	}
	if c := patch("u-alice", map[string]any{"displayName": "Owner Named"}); c != 200 {
		t.Errorf("owner rename: %d", c)
	}
	if c := patch("u-admin", map[string]any{"visibility": "internal"}); c != 200 {
		t.Errorf("admin patch: %d", c)
	}
	p := profileOf(t, f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: "u-carol"}))
	if p["description"] != "by the editor" || p["color"] != "teal" || p["displayName"] != "Owner Named" {
		t.Errorf("after edits: %v", p)
	}
}

func TestProfileImage(t *testing.T) {
	f, ns := setupProfileBrain(t)
	img := tinyPNG(t)

	if rec := f.upload("u-bob", ns, "image", "a.png", img); rec.Code != 403 {
		t.Errorf("editor upload: %d", rec.Code)
	}
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	if rec := f.upload("u-alice", ns, "image", "a.svg", svg); rec.Code != 415 {
		t.Errorf("svg upload: %d %s", rec.Code, rec.Body.String())
	}
	if rec := f.upload("u-alice", ns, "image", "a.txt", []byte("hello")); rec.Code != 415 {
		t.Errorf("text upload: %d", rec.Code)
	}
	big := append(append([]byte{}, img...), make([]byte, maxImageBytes)...)
	if rec := f.upload("u-alice", ns, "image", "big.png", big); rec.Code != 413 {
		t.Errorf("big upload: %d", rec.Code)
	}
	if rec := f.upload("u-alice", ns, "banner", "a.png", img); rec.Code != 400 {
		t.Errorf("bad kind: %d", rec.Code)
	}
	rec := f.upload("u-alice", ns, "image", "a.png", img)
	if rec.Code != 200 {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	u, _ := decodeMap(t, rec)["url"].(string)
	if !strings.HasPrefix(u, "/api/brain/profile/image/"+ns+"/image?v=") {
		t.Fatalf("url = %q", u)
	}
	if p := profileOf(t, f.do(req{method: "GET", path: "/api/brain/profile?namespace=" + ns, user: "u-alice"})); p["imageUrl"] != u {
		t.Errorf("profile imageUrl = %v", p["imageUrl"])
	}

	// Members read it (with an ETag); others do not.
	rec = f.do(req{method: "GET", path: u, user: "u-carol"})
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rec.Body.Bytes(), img) {
		t.Fatalf("viewer image: %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	etag := rec.Header().Get("ETag")
	if etag == "" || !strings.Contains(rec.Header().Get("Cache-Control"), "private") {
		t.Errorf("headers: %v", rec.Header())
	}
	if rec := f.do(req{method: "GET", path: u, user: "u-carol", headers: map[string]string{"If-None-Match": etag}}); rec.Code != 304 {
		t.Errorf("conditional get: %d", rec.Code)
	}
	for _, user := range []string{"u-dave", ""} {
		if rec := f.do(req{method: "GET", path: u, user: user}); rec.Code != 403 {
			t.Errorf("image as %q: %d", user, rec.Code)
		}
	}
	if rec := f.do(req{method: "GET", path: "/api/brain/profile/image/" + ns + "/cover", user: "u-alice"}); rec.Code != 404 {
		t.Errorf("missing cover: %d", rec.Code)
	}

	// Remove: owner only; then it is gone.
	if rec := f.do(req{method: "DELETE", path: "/api/brain/profile/image?namespace=" + ns + "&kind=image", user: "u-bob"}); rec.Code != 403 {
		t.Errorf("editor delete: %d", rec.Code)
	}
	if rec := f.do(req{method: "DELETE", path: "/api/brain/profile/image?namespace=" + ns + "&kind=image", user: "u-alice"}); rec.Code != 200 {
		t.Errorf("owner delete: %d %s", rec.Code, rec.Body.String())
	}
	if rec := f.do(req{method: "GET", path: u, user: "u-alice"}); rec.Code != 404 {
		t.Errorf("after delete: %d", rec.Code)
	}
}
