package brain

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

/*
Push a brain's notes to a GitHub repository (MH-316, first slice).

Scope, decided on the issue and deliberately narrow:

  - ONE-WAY. Zekra is the source of truth; the repo is an export target. Nothing
    is ever read back, so there is no second version line to reconcile. Pulling
    is the hard half (a note carries a version, a graph node and an embedding;
    a file carries none of that) and it is not attempted here.
  - PAT, not OAuth. The token lives in the brain's existing encrypted secret
    store under a reserved name, so this adds no new place for a credential to
    live. An OAuth app is the right answer for a hosted product and is what
    should replace this; see the note on Authorship below.
  - Images stay as absolute URLs. They are content-addressed blobs behind
    /api/notes/image and only resolve for a signed-in caller, so a pushed note's
    images are visible in Zekra and not on GitHub. Rewriting them means
    committing the blobs too, which is its own decision about repo size.

WHAT THIS DELIBERATELY DOES NOT DO: authorship. Every commit is authored by the
token's owner, because that is who GitHub says is pushing. Attributing a commit
to the Zekra user who wrote the note needs either their GitHub identity (OAuth)
or a bot identity with a Co-authored-by trailer — issue item 3, still open.
*/

// ReservedGitHubSecret is where the PAT lives in the brain's secret store.
// Reserved: a note sync cannot be pointed at an arbitrary secret name, or a
// caller with write access could exfiltrate any secret in the brain by asking
// the sync to authenticate with it.
const ReservedGitHubSecret = "github_token"

// DefaultPathTemplate lays notes out one file per note under notes/.
const DefaultPathTemplate = "notes/{slug}.md"

var githubAPI = "https://api.github.com"

// GitHubSyncConfig is where a brain's notes go.
type GitHubSyncConfig struct {
	Namespace string `json:"namespace"`
	// Owner/Repo as they appear in the URL.
	Owner  string `json:"owner"`
	Repo   string `json:"repo"`
	Branch string `json:"branch"`
	// PathTemplate understands {slug} and {id}. It must end in .md and must not
	// escape the repository root.
	PathTemplate string `json:"pathTemplate"`
	Enabled      bool   `json:"enabled"`
	LastPushAt   string `json:"lastPushAt,omitempty"`
	LastCommit   string `json:"lastCommit,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
}

var (
	// GitHub's own rules: owner and repo are limited to these characters.
	ownerPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$`)
	repoPattern  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
	// A branch name, restricted well inside git's rules — no refspec syntax, no
	// leading dash, nothing that could be read as a flag or a path traversal.
	branchPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,240}$`)
)

// Validate checks a config before it is stored, so a bad one cannot be saved
// and then fail at push time with a confusing GitHub error.
func (c *GitHubSyncConfig) Validate() error {
	c.Owner = strings.TrimSpace(c.Owner)
	c.Repo = strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(c.Repo), ".git"))
	c.Branch = strings.TrimSpace(c.Branch)
	c.PathTemplate = strings.TrimSpace(c.PathTemplate)

	if !ownerPattern.MatchString(c.Owner) {
		return errors.New("owner must be a GitHub username or organisation")
	}
	if !repoPattern.MatchString(c.Repo) {
		return errors.New("repo must be a GitHub repository name")
	}
	if c.Branch == "" {
		c.Branch = "main"
	}
	if !branchPattern.MatchString(c.Branch) || strings.Contains(c.Branch, "..") {
		return errors.New("branch is not a valid branch name")
	}
	if c.PathTemplate == "" {
		c.PathTemplate = DefaultPathTemplate
	}
	return validatePathTemplate(c.PathTemplate)
}

func validatePathTemplate(tpl string) error {
	if !strings.HasSuffix(tpl, ".md") {
		return errors.New("pathTemplate must end in .md")
	}
	if !strings.Contains(tpl, "{slug}") && !strings.Contains(tpl, "{id}") {
		// Without a per-note placeholder every note writes the same path and
		// all but one silently vanish.
		return errors.New("pathTemplate must contain {slug} or {id}")
	}
	// Resolve the template with a worst-case value and check where it lands.
	probe := strings.NewReplacer("{slug}", "x", "{id}", "x").Replace(tpl)
	if strings.HasPrefix(probe, "/") || strings.HasPrefix(probe, ".") {
		return errors.New("pathTemplate must be a relative path inside the repository")
	}
	for _, segment := range strings.Split(probe, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return errors.New("pathTemplate must not contain empty or relative segments")
		}
	}
	return nil
}

// ── storage ───────────────────────────────────────────────────────────────────

// GetGitHubSync reads a brain's config. A brain with none gets the zero value
// with Enabled false, not an error — "not configured" is a normal state the UI
// has to render.
func (s *Store) GetGitHubSync(ctx context.Context, ns string) (GitHubSyncConfig, error) {
	cfg := GitHubSyncConfig{Namespace: ns, Branch: "main", PathTemplate: DefaultPathTemplate}
	db, err := s.db(ctx)
	if err != nil {
		return cfg, err
	}
	var lastPush sql.NullTime
	var updated time.Time
	err = db.QueryRowContext(ctx, `
		SELECT owner, repo, branch, path_template, enabled, last_push_at, last_commit, updated_at
		FROM note_github_sync WHERE namespace = $1`, ns).
		Scan(&cfg.Owner, &cfg.Repo, &cfg.Branch, &cfg.PathTemplate, &cfg.Enabled, &lastPush, &cfg.LastCommit, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if lastPush.Valid {
		cfg.LastPushAt = lastPush.Time.UTC().Format(time.RFC3339)
	}
	cfg.UpdatedAt = updated.UTC().Format(time.RFC3339)
	return cfg, nil
}

// PutGitHubSync upserts a brain's config. Validate first.
func (s *Store) PutGitHubSync(ctx context.Context, cfg GitHubSyncConfig, by string) error {
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO note_github_sync (namespace, owner, repo, branch, path_template, enabled, updated_at, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6, now(), $7)
		ON CONFLICT (namespace) DO UPDATE
		  SET owner = EXCLUDED.owner, repo = EXCLUDED.repo, branch = EXCLUDED.branch,
		      path_template = EXCLUDED.path_template, enabled = EXCLUDED.enabled,
		      updated_at = now(), updated_by = EXCLUDED.updated_by`,
		cfg.Namespace, cfg.Owner, cfg.Repo, cfg.Branch, cfg.PathTemplate, cfg.Enabled, nullStr(by))
	return err
}

// DeleteGitHubSync forgets a brain's config. The PAT is a separate secret and
// is left alone — deleting it is the secret store's job, and silently revoking
// a credential the user may use elsewhere would be surprising.
func (s *Store) DeleteGitHubSync(ctx context.Context, ns string) error {
	db, err := s.db(ctx)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `DELETE FROM note_github_sync WHERE namespace = $1`, ns)
	return err
}

func (s *Store) markGitHubPushed(ctx context.Context, ns, commit string) {
	db, err := s.db(ctx)
	if err != nil {
		return
	}
	// Best effort: the push already happened, and failing to record it must not
	// turn a successful push into an error the caller retries.
	_, _ = db.ExecContext(ctx,
		`UPDATE note_github_sync SET last_push_at = now(), last_commit = $2 WHERE namespace = $1`, ns, commit)
}

// ── note -> file ──────────────────────────────────────────────────────────────

var slugStrip = regexp.MustCompile(`[^a-z0-9]+`)

// noteSlug is a filename-safe form of the title, falling back to the id.
//
// It is NOT unique on its own: two notes may legitimately share a title (the
// graph layer already relies on that). RenderNoteFiles disambiguates.
func noteSlug(n Note) string {
	lowered := strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToLower(r)
		}
		return ' '
	}, n.Title)
	s := strings.Trim(slugStrip.ReplaceAllString(strings.TrimSpace(lowered), "-"), "-")
	if s == "" {
		// A title of only punctuation, or an Arabic title — unicode.IsLetter
		// accepts Arabic, but the ASCII strip removes it, so this is the common
		// case for an Arabic-titled note rather than an exotic one.
		return n.ID
	}
	if len(s) > 80 {
		s = strings.Trim(s[:80], "-")
	}
	return s
}

// yamlString quotes a scalar for front matter. Everything is quoted rather than
// only what needs it: a title of "yes", "null" or "2024-01-01" is otherwise
// parsed as a bool, a null or a date by any YAML reader.
func yamlString(v string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\r", "").Replace(v) + `"`
}

// RenderNote turns a note into the file that represents it.
func RenderNote(n Note) string {
	var b strings.Builder
	b.WriteString("---\n")
	fmt.Fprintf(&b, "title: %s\n", yamlString(n.Title))
	if n.Description != "" {
		fmt.Fprintf(&b, "description: %s\n", yamlString(n.Description))
	}
	if n.Category != "" {
		fmt.Fprintf(&b, "category: %s\n", yamlString(n.Category))
	}
	if len(n.Tags) > 0 {
		quoted := make([]string, len(n.Tags))
		for i, t := range n.Tags {
			quoted[i] = yamlString(t)
		}
		fmt.Fprintf(&b, "tags: [%s]\n", strings.Join(quoted, ", "))
	}
	if n.Pinned {
		b.WriteString("pinned: true\n")
	}
	if n.Archived {
		b.WriteString("archived: true\n")
	}
	// The round-trip anchors: which note this is, and which revision of it. A
	// future two-way sync needs both to tell "changed here" from "changed there".
	fmt.Fprintf(&b, "zekra_id: %s\n", yamlString(n.ID))
	fmt.Fprintf(&b, "zekra_version: %d\n", n.Version)
	fmt.Fprintf(&b, "updated_at: %s\n", yamlString(n.UpdatedAt.UTC().Format(time.RFC3339)))
	b.WriteString("---\n\n")

	body := strings.ReplaceAll(n.Body, "\r\n", "\n")
	b.WriteString(body)
	if !strings.HasSuffix(body, "\n") {
		// A file without a trailing newline shows as "\ No newline at end of
		// file" in every diff, forever.
		b.WriteString("\n")
	}
	return b.String()
}

// NoteFile is one rendered note, at the path it belongs at.
type NoteFile struct {
	Path    string
	Content string
}

// RenderNoteFiles renders every note and resolves path collisions.
//
// Two notes may share a title, so two notes may produce the same slug. Rather
// than let one silently overwrite the other, the second and subsequent get a
// short suffix from their id. Deterministic: notes are sorted by id first, so
// the same set always produces the same files and a re-push is a no-op diff.
func RenderNoteFiles(notes []Note, pathTemplate string) []NoteFile {
	sorted := append([]Note(nil), notes...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })

	seen := map[string]int{}
	out := make([]NoteFile, 0, len(sorted))
	for _, n := range sorted {
		slug := noteSlug(n)
		path := strings.NewReplacer("{slug}", slug, "{id}", n.ID).Replace(pathTemplate)
		if count := seen[path]; count > 0 {
			short := n.ID
			if len(short) > 8 {
				short = short[:8]
			}
			path = strings.NewReplacer("{slug}", slug+"-"+short, "{id}", n.ID).Replace(pathTemplate)
		}
		seen[path]++
		out = append(out, NoteFile{Path: path, Content: RenderNote(n)})
	}
	return out
}

// ── GitHub ────────────────────────────────────────────────────────────────────

var githubClient = &http.Client{Timeout: 60 * time.Second}

type githubError struct {
	Status  int
	Message string
}

func (e *githubError) Error() string {
	return fmt.Sprintf("github: %s (HTTP %d)", e.Message, e.Status)
}

func githubCall(ctx context.Context, token, method, path string, body any, out any) error {
	var payload io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, githubAPI+path, payload)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "zekra")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := githubClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	// Cap the read: a proxy in front of the API could otherwise stream forever.
	raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return err
	}
	if res.StatusCode >= 400 {
		var detail struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(raw, &detail)
		if detail.Message == "" {
			detail.Message = strings.TrimSpace(string(raw))
		}
		// The token must never reach a log or an API response.
		return &githubError{Status: res.StatusCode, Message: detail.Message}
	}
	if out != nil && len(raw) > 0 {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// PushResult is what a push did.
type PushResult struct {
	Commit    string `json:"commit"`
	Files     int    `json:"files"`
	Branch    string `json:"branch"`
	Unchanged bool   `json:"unchanged"`
	URL       string `json:"url,omitempty"`
}

/*
PushNotes writes every note in the brain to the repo as ONE commit.

One commit, not one per note: the Git data API builds a tree and a commit
explicitly, so a brain with 400 notes produces one entry in the history instead
of 400. The contents API would have been fewer lines and a far worse result.

The tree is built on top of the branch's existing tree, so files the repo has
that Zekra does not are left alone — this pushes notes into a repo, it does not
take the repo over. The corollary, stated plainly because it will surprise
someone: a note DELETED in Zekra is not deleted from the repo.
*/
func (s *Service) PushNotes(ctx context.Context, ns string, cfg GitHubSyncConfig, token string) (*PushResult, error) {
	page, err := s.Store.ListNotes(ctx, NoteQuery{Namespaces: []string{ns}, Limit: 5000})
	if err != nil {
		return nil, err
	}
	notes := make([]Note, 0, len(page.Notes))
	for _, n := range page.Notes {
		// Tombstones have no content worth committing.
		if n.Deleted {
			continue
		}
		notes = append(notes, n)
	}
	if len(notes) == 0 {
		return nil, errors.New("this brain has no notes to push")
	}
	files := RenderNoteFiles(notes, cfg.PathTemplate)

	repo := "/repos/" + cfg.Owner + "/" + cfg.Repo

	// 1. Where the branch is now.
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := githubCall(ctx, token, http.MethodGet, repo+"/git/ref/heads/"+cfg.Branch, nil, &ref); err != nil {
		return nil, err
	}
	var head struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if err := githubCall(ctx, token, http.MethodGet, repo+"/git/commits/"+ref.Object.SHA, nil, &head); err != nil {
		return nil, err
	}

	// 2. A blob per file. Base64 rather than raw UTF-8: a note may contain
	//    anything, and the API's "utf-8" encoding rejects invalid sequences.
	type treeEntry struct {
		Path string `json:"path"`
		Mode string `json:"mode"`
		Type string `json:"type"`
		SHA  string `json:"sha"`
	}
	entries := make([]treeEntry, 0, len(files))
	for _, f := range files {
		var blob struct {
			SHA string `json:"sha"`
		}
		body := map[string]string{"content": base64.StdEncoding.EncodeToString([]byte(f.Content)), "encoding": "base64"}
		if err := githubCall(ctx, token, http.MethodPost, repo+"/git/blobs", body, &blob); err != nil {
			return nil, err
		}
		entries = append(entries, treeEntry{Path: f.Path, Mode: "100644", Type: "blob", SHA: blob.SHA})
	}

	// 3. A tree on top of what is already there.
	var tree struct {
		SHA string `json:"sha"`
	}
	if err := githubCall(ctx, token, http.MethodPost, repo+"/git/trees",
		map[string]any{"base_tree": head.Tree.SHA, "tree": entries}, &tree); err != nil {
		return nil, err
	}
	if tree.SHA == head.Tree.SHA {
		// Nothing changed. Committing anyway would put an empty commit in the
		// history every time someone pressed the button.
		s.Store.markGitHubPushed(ctx, ns, ref.Object.SHA)
		return &PushResult{Commit: ref.Object.SHA, Files: len(files), Branch: cfg.Branch, Unchanged: true}, nil
	}

	// 4. The commit, and move the branch onto it.
	var commit struct {
		SHA     string `json:"sha"`
		HTMLURL string `json:"html_url"`
	}
	message := fmt.Sprintf("Sync %d note%s from the %s brain", len(files), plural(len(files)), ns)
	if err := githubCall(ctx, token, http.MethodPost, repo+"/git/commits",
		map[string]any{"message": message, "tree": tree.SHA, "parents": []string{ref.Object.SHA}}, &commit); err != nil {
		return nil, err
	}
	// force:false, so a branch that moved under us fails rather than losing the
	// commits that arrived in between.
	if err := githubCall(ctx, token, http.MethodPatch, repo+"/git/refs/heads/"+cfg.Branch,
		map[string]any{"sha": commit.SHA, "force": false}, nil); err != nil {
		return nil, err
	}

	s.Store.markGitHubPushed(ctx, ns, commit.SHA)
	return &PushResult{Commit: commit.SHA, Files: len(files), Branch: cfg.Branch, URL: commit.HTMLURL}, nil
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}
