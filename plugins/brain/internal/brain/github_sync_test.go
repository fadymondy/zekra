package brain

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// --- pure: validation ------------------------------------------------------------

func TestGitHubSyncConfigValidation(t *testing.T) {
	ok := []GitHubSyncConfig{
		{Owner: "fadymondy", Repo: "zekra"},
		{Owner: "a", Repo: "b.c-d_e", Branch: "release/2.0"},
		{Owner: "Org-Name", Repo: "notes", PathTemplate: "docs/brain/{id}.md"},
	}
	for _, c := range ok {
		cfg := c
		if err := cfg.Validate(); err != nil {
			t.Errorf("%+v rejected: %v", c, err)
		}
	}
	// Defaults are filled in rather than left empty, so a stored config is
	// always complete enough to push with.
	cfg := GitHubSyncConfig{Owner: "o", Repo: "r"}
	_ = cfg.Validate()
	if cfg.Branch != "main" || cfg.PathTemplate != DefaultPathTemplate {
		t.Errorf("defaults not applied: %+v", cfg)
	}
	// ".git" is what you get from copying a clone URL; accept it and strip it
	// rather than failing with "repo must be a repository name".
	cfg = GitHubSyncConfig{Owner: "o", Repo: "r.git"}
	_ = cfg.Validate()
	if cfg.Repo != "r" {
		t.Errorf("trailing .git not stripped: %q", cfg.Repo)
	}

	bad := map[string]GitHubSyncConfig{
		"empty owner":        {Owner: "", Repo: "r"},
		"owner with slash":   {Owner: "a/b", Repo: "r"},
		"owner with space":   {Owner: "a b", Repo: "r"},
		"empty repo":         {Owner: "o", Repo: ""},
		"repo with slash":    {Owner: "o", Repo: "a/b"},
		"branch with ..":     {Owner: "o", Repo: "r", Branch: "a..b"},
		"branch leading -":   {Owner: "o", Repo: "r", Branch: "-delete"},
		"branch with space":  {Owner: "o", Repo: "r", Branch: "my branch"},
		"template not md":    {Owner: "o", Repo: "r", PathTemplate: "notes/{slug}.txt"},
		"template absolute":  {Owner: "o", Repo: "r", PathTemplate: "/etc/{slug}.md"},
		"template traversal": {Owner: "o", Repo: "r", PathTemplate: "../{slug}.md"},
		"template escape":    {Owner: "o", Repo: "r", PathTemplate: "notes/../../{slug}.md"},
		"template constant":  {Owner: "o", Repo: "r", PathTemplate: "notes/all.md"},
	}
	for name, c := range bad {
		cfg := c
		if err := cfg.Validate(); err == nil {
			t.Errorf("%s was accepted: %+v", name, cfg)
		}
	}
}

// --- pure: rendering -------------------------------------------------------------

func testNote(id, title, body string) Note {
	return Note{
		ID: id, Title: title, Body: body, Version: 3,
		UpdatedAt: time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC),
	}
}

func TestRenderNoteFrontMatter(t *testing.T) {
	n := testNote("abc", "Launch plan", "# Heading\n\nBody.")
	n.Category = "meeting"
	n.Tags = []string{"q3", "launch"}
	n.Pinned = true

	out := RenderNote(n)
	for _, want := range []string{
		"---\n", `title: "Launch plan"`, `category: "meeting"`,
		`tags: ["q3", "launch"]`, "pinned: true",
		`zekra_id: "abc"`, "zekra_version: 3", `updated_at: "2026-09-22T10:00:00Z"`,
		"\n---\n\n# Heading\n\nBody.\n",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	// archived is omitted when false rather than written as false — front
	// matter should describe the note, not enumerate every field.
	if strings.Contains(out, "archived:") {
		t.Error("archived written for a non-archived note")
	}
}

func TestRenderNoteQuotesAmbiguousScalars(t *testing.T) {
	// The reason everything is quoted: unquoted, each of these parses as a
	// bool, a null, a number or a date rather than as the title it is.
	for _, title := range []string{"yes", "no", "null", "2024-01-01", "1.0"} {
		out := RenderNote(testNote("i", title, "b"))
		if !strings.Contains(out, `title: "`+title+`"`) {
			t.Errorf("%q not quoted:\n%s", title, out)
		}
	}
	// A quote or a newline in a title must not break out of the scalar.
	out := RenderNote(testNote("i", "He said \"hi\"\nand left", "b"))
	if !strings.Contains(out, `title: "He said \"hi\"\nand left"`) {
		t.Errorf("escaping wrong:\n%s", out)
	}
	// Front matter must still be exactly one closing delimiter.
	if strings.Count(out, "\n---\n") != 1 || !strings.HasPrefix(out, "---\n") {
		t.Errorf("front matter delimiters broken:\n%s", out)
	}
}

func TestRenderNoteAlwaysEndsWithOneNewline(t *testing.T) {
	// Otherwise every diff shows "\ No newline at end of file", forever.
	for _, body := range []string{"no trailing", "has trailing\n"} {
		out := RenderNote(testNote("i", "t", body))
		if !strings.HasSuffix(out, "\n") || strings.HasSuffix(out, "\n\n\n") {
			t.Errorf("bad trailer for %q: %q", body, out)
		}
	}
}

func TestRenderNoteFilePaths(t *testing.T) {
	files := RenderNoteFiles([]Note{
		testNote("id-1", "Launch Plan!", "a"),
		testNote("id-2", "launch  plan", "b"), // same slug as id-1
		testNote("id-3", "خطة الإطلاق", "c"),  // no ASCII: falls back to the id
		testNote("id-4", "", "d"),             // no title at all
	}, DefaultPathTemplate)

	paths := make([]string, len(files))
	for i, f := range files {
		paths[i] = f.Path
	}
	// Sorted by id, so the output is stable and a re-push is a no-op diff.
	want := []string{"notes/launch-plan.md", "notes/launch-plan-id-2.md", "notes/id-3.md", "notes/id-4.md"}
	for i := range want {
		if paths[i] != want[i] {
			t.Errorf("path %d = %q, want %q (all: %v)", i, paths[i], want[i], paths)
		}
	}
	if len(files) != 4 {
		t.Fatalf("want 4 files, got %d", len(files))
	}
	seen := map[string]bool{}
	for _, f := range files {
		if seen[f.Path] {
			t.Errorf("duplicate path %q — a note would be overwritten", f.Path)
		}
		seen[f.Path] = true
	}
}

func TestRenderNoteFilesIsDeterministic(t *testing.T) {
	notes := []Note{testNote("b", "Same", "1"), testNote("a", "Same", "2"), testNote("c", "Same", "3")}
	first := RenderNoteFiles(notes, DefaultPathTemplate)
	// Feed them in a different order; the result must not move.
	second := RenderNoteFiles([]Note{notes[2], notes[0], notes[1]}, DefaultPathTemplate)
	for i := range first {
		if first[i].Path != second[i].Path || first[i].Content != second[i].Content {
			t.Fatalf("not deterministic at %d: %q vs %q", i, first[i].Path, second[i].Path)
		}
	}
}

// --- database + a fake GitHub ----------------------------------------------------

// fakeGitHub implements just enough of the git data API to exercise a push, and
// records what it was asked to do.
type fakeGitHub struct {
	server  *httptest.Server
	tree    []map[string]any
	message string
	auth    string
	newTree bool // report a changed tree (false = "nothing to commit")
	pushed  bool
}

func newFakeGitHub(t *testing.T, changed bool) *fakeGitHub {
	t.Helper()
	f := &fakeGitHub{newTree: changed}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		f.auth = r.Header.Get("Authorization")
		body := map[string]any{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch {
		case strings.HasSuffix(r.URL.Path, "/git/ref/heads/main"):
			_ = json.NewEncoder(w).Encode(map[string]any{"object": map[string]string{"sha": "base-commit"}})
		case strings.Contains(r.URL.Path, "/git/commits/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"tree": map[string]string{"sha": "base-tree"}})
		case strings.HasSuffix(r.URL.Path, "/git/blobs"):
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": "blob-sha"})
		case strings.HasSuffix(r.URL.Path, "/git/trees"):
			if raw, ok := body["tree"].([]any); ok {
				for _, e := range raw {
					if m, ok := e.(map[string]any); ok {
						f.tree = append(f.tree, m)
					}
				}
			}
			sha := "base-tree"
			if f.newTree {
				sha = "new-tree"
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": sha})
		case strings.HasSuffix(r.URL.Path, "/git/commits"):
			f.message, _ = body["message"].(string)
			_ = json.NewEncoder(w).Encode(map[string]string{"sha": "new-commit", "html_url": "https://github.test/c"})
		case strings.Contains(r.URL.Path, "/git/refs/heads/"):
			f.pushed = true
			if force, ok := body["force"].(bool); ok && force {
				t.Error("ref updated with force:true — this can discard commits")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"ref": "refs/heads/main"})
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"Not Found"}`))
		}
	})
	f.server = httptest.NewServer(mux)

	previous := githubAPI
	githubAPI = f.server.URL
	t.Cleanup(func() { githubAPI = previous; f.server.Close() })
	return f
}

func TestGitHubSyncConfigRoundTripsAndHidesTheToken(t *testing.T) {
	f := newFix(t)
	ns := f.ns("ghcfg")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-ed','editor')`, ns)

	save := func(user string, body map[string]any) *httptest.ResponseRecorder {
		body["namespace"] = ns
		return f.do(req{method: "PUT", path: "/api/brain/notes/github", user: user, body: body})
	}

	// An editor may write notes but must not decide where the brain is published.
	if rec := save("u-ed", map[string]any{"owner": "o", "repo": "r"}); rec.Code != http.StatusForbidden {
		t.Fatalf("editor could configure sync: %d %s", rec.Code, rec.Body)
	}
	if rec := save("u-alice", map[string]any{"owner": "bad owner", "repo": "r"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid owner accepted: %d %s", rec.Code, rec.Body)
	}

	rec := save("u-alice", map[string]any{"owner": "fadymondy", "repo": "zekra", "enabled": true, "token": "ghp_secret"})
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "ghp_secret") {
		t.Fatal("the response echoed the token back")
	}

	rec = f.do(req{method: "GET", path: "/api/brain/notes/github?namespace=" + ns, user: "u-alice"})
	if rec.Code != http.StatusOK {
		t.Fatalf("get: %d %s", rec.Code, rec.Body)
	}
	var got struct {
		Config   GitHubSyncConfig `json:"config"`
		HasToken bool             `json:"hasToken"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Config.Owner != "fadymondy" || got.Config.Repo != "zekra" || !got.Config.Enabled {
		t.Errorf("config did not round-trip: %+v", got.Config)
	}
	if got.Config.Branch != "main" || got.Config.PathTemplate != DefaultPathTemplate {
		t.Errorf("defaults missing: %+v", got.Config)
	}
	if !got.HasToken {
		t.Error("hasToken false after storing one")
	}
	if strings.Contains(rec.Body.String(), "ghp_secret") {
		t.Fatal("GET leaked the token")
	}
	// A brain with no config reads as "not configured", not as an error.
	other := f.ns("ghnone")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, other)
	rec = f.do(req{method: "GET", path: "/api/brain/notes/github?namespace=" + other, user: "u-alice"})
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("unconfigured brain: %d %s", rec.Code, rec.Body)
	}
}

func TestGitHubPushRefusesWithoutConfigTokenOrToggle(t *testing.T) {
	f := newFix(t)
	ns := f.ns("ghguard")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner'), ($1,'u-ed','editor')`, ns)
	push := func(user string) *httptest.ResponseRecorder {
		return f.do(req{method: "POST", path: "/api/brain/notes/github/push", user: user, body: map[string]any{"namespace": ns}})
	}

	// No config at all.
	if rec := push("u-alice"); rec.Code != http.StatusBadRequest {
		t.Errorf("push without config: %d %s", rec.Code, rec.Body)
	}
	// Configured but disabled: the toggle has to mean something.
	f.do(req{method: "PUT", path: "/api/brain/notes/github", user: "u-alice",
		body: map[string]any{"namespace": ns, "owner": "o", "repo": "r", "enabled": false, "token": "t"}})
	if rec := push("u-alice"); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "turned off") {
		t.Errorf("push while disabled: %d %s", rec.Code, rec.Body)
	}
	// Enabled, no token.
	other := f.ns("ghnotoken")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, other)
	f.do(req{method: "PUT", path: "/api/brain/notes/github", user: "u-alice",
		body: map[string]any{"namespace": other, "owner": "o", "repo": "r", "enabled": true}})
	rec := f.do(req{method: "POST", path: "/api/brain/notes/github/push", user: "u-alice", body: map[string]any{"namespace": other}})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "no GitHub token") {
		t.Errorf("push without a token: %d %s", rec.Code, rec.Body)
	}
	// An editor cannot trigger a push using a token they cannot read.
	if rec := push("u-ed"); rec.Code != http.StatusForbidden {
		t.Errorf("editor could push: %d %s", rec.Code, rec.Body)
	}
}

func TestGitHubPushMakesOneCommit(t *testing.T) {
	f := newFix(t)
	gh := newFakeGitHub(t, true)
	ns := f.ns("ghpush")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	for _, title := range []string{"First note", "Second note"} {
		rec := f.do(req{method: "POST", path: "/api/notes", user: "u-alice",
			body: map[string]any{"namespace": ns, "title": title, "body": "content of " + title}})
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body)
		}
	}
	f.do(req{method: "PUT", path: "/api/brain/notes/github", user: "u-alice",
		body: map[string]any{"namespace": ns, "owner": "fadymondy", "repo": "zekra", "enabled": true, "token": "ghp_x"}})

	rec := f.do(req{method: "POST", path: "/api/brain/notes/github/push", user: "u-alice", body: map[string]any{"namespace": ns}})
	if rec.Code != http.StatusOK {
		t.Fatalf("push: %d %s", rec.Code, rec.Body)
	}
	var result PushResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Commit != "new-commit" || result.Files != 2 || result.Unchanged {
		t.Fatalf("result: %+v", result)
	}
	if !gh.pushed {
		t.Error("the branch ref was never moved")
	}
	// ONE commit for the whole brain, not one per note.
	if !strings.Contains(gh.message, "2 notes") {
		t.Errorf("commit message %q", gh.message)
	}
	if len(gh.tree) != 2 {
		t.Fatalf("tree had %d entries", len(gh.tree))
	}
	for _, entry := range gh.tree {
		if entry["mode"] != "100644" || entry["type"] != "blob" {
			t.Errorf("bad tree entry %+v", entry)
		}
		if path, _ := entry["path"].(string); !strings.HasPrefix(path, "notes/") || !strings.HasSuffix(path, ".md") {
			t.Errorf("bad path %q", path)
		}
	}
	if gh.auth != "Bearer ghp_x" {
		t.Errorf("auth header %q — the stored token was not used", gh.auth)
	}
	// The push is recorded so the UI can show when it last ran.
	cfg, err := f.svc.Store.GetGitHubSync(t.Context(), ns)
	if err != nil || cfg.LastCommit != "new-commit" || cfg.LastPushAt == "" {
		t.Errorf("push not recorded: %+v (%v)", cfg, err)
	}
}

func TestGitHubPushSkipsAnEmptyCommit(t *testing.T) {
	f := newFix(t)
	newFakeGitHub(t, false) // the tree comes back identical
	ns := f.ns("ghsame")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: map[string]any{"namespace": ns, "title": "N", "body": "b"}})
	f.do(req{method: "PUT", path: "/api/brain/notes/github", user: "u-alice",
		body: map[string]any{"namespace": ns, "owner": "o", "repo": "r", "enabled": true, "token": "t"}})

	rec := f.do(req{method: "POST", path: "/api/brain/notes/github/push", user: "u-alice", body: map[string]any{"namespace": ns}})
	if rec.Code != http.StatusOK {
		t.Fatalf("push: %d %s", rec.Code, rec.Body)
	}
	var result PushResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	// Otherwise every press of the button adds an empty commit to the history.
	if !result.Unchanged || result.Commit != "base-commit" {
		t.Fatalf("expected an unchanged push, got %+v", result)
	}
}

func TestGitHubPushReportsGitHubErrorsUsefully(t *testing.T) {
	f := newFix(t)
	// No routes match, so every call 404s — the shape of "bad token, or the
	// repo does not exist", which is the most common real failure.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"Not Found"}`))
	}))
	previous := githubAPI
	githubAPI = server.URL
	t.Cleanup(func() { githubAPI = previous; server.Close() })

	ns := f.ns("gherr")
	f.exec(`INSERT INTO brain_members (namespace, user_id, role) VALUES ($1,'u-alice','owner')`, ns)
	f.do(req{method: "POST", path: "/api/notes", user: "u-alice", body: map[string]any{"namespace": ns, "title": "N", "body": "b"}})
	f.do(req{method: "PUT", path: "/api/brain/notes/github", user: "u-alice",
		body: map[string]any{"namespace": ns, "owner": "o", "repo": "r", "enabled": true, "token": "ghp_bad"}})

	rec := f.do(req{method: "POST", path: "/api/brain/notes/github/push", user: "u-alice", body: map[string]any{"namespace": ns}})
	// 400, not 500: the caller can fix this, and a 5xx would send them looking
	// at Zekra rather than at their token.
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "Not Found") {
		t.Errorf("GitHub's message was swallowed: %s", rec.Body)
	}
	if strings.Contains(rec.Body.String(), "ghp_bad") {
		t.Fatal("the token leaked into an error response")
	}
}
