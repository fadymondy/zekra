package presentations

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"
)

/*
Share links (FM-342).

A document is private until the owner shares it. A share is a random token
(32 bytes from crypto/rand, base64url, 43 characters) whose SHA-256 is the
only thing a public request is matched on. The token itself is kept only
sealed (seal.go), so the owner can copy the link again; without a sealing key it is
shown once, at creation, and never again.

Unknown, revoked and expired tokens all answer the same ErrLinkUnavailable:
a stranger probing tokens learns nothing about which ones once existed.
*/

// ErrLinkUnavailable is every reason a token does not open a document.
var ErrLinkUnavailable = errors.New("this link is not valid: it may have expired or been revoked")

const tokenBytes = 32

// PresentationShare is one link, as the owner sees it.
type PresentationShare struct {
	ID             string     `json:"id"`
	PresentationID string     `json:"presentation_id"`
	Label          string     `json:"label"`
	Locale         string     `json:"locale"`
	Hint           string     `json:"hint"`
	URL            string     `json:"url"`
	ExpiresAt      *time.Time `json:"expires_at"`
	RevokedAt      *time.Time `json:"revoked_at"`
	Active         bool       `json:"active"`
	ViewCount      int64      `json:"view_count"`
	DownloadCount  int64      `json:"download_count"`
	LastViewedAt   *time.Time `json:"last_viewed_at"`
	CreatedAt      time.Time  `json:"created_at"`
}

// PresentationShareInput creates a link.
type PresentationShareInput struct {
	Label string `json:"label,omitempty" maxLength:"80"`
	// en | ar; defaults to the document's locale.
	Locale string `json:"locale,omitempty"`
	// Days until the link stops working; 0 = never.
	ExpiresInDays int `json:"expires_in_days,omitempty" minimum:"0" maximum:"3650"`
}

// PresentationShareCreated carries the one moment the token is always visible.
type PresentationShareCreated struct {
	Share PresentationShare `json:"share"`
	Token string            `json:"token"`
	URL   string            `json:"url"`
	// Whether the owner can copy this link again later (VAULT_KEY set).
	Recoverable bool `json:"recoverable"`
}

// HashToken is the stored form of a token.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// NewToken returns a fresh unguessable token.
func NewToken() (string, error) {
	b := make([]byte, tokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// validTokenShape rejects anything that could not be one of ours before a
// database round trip.
func validTokenShape(token string) bool {
	if len(token) != 43 {
		return false
	}
	for _, c := range token {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// DefaultShareBase is the share origin when nothing is configured.
const DefaultShareBase = "https://app.zekra.dev"

// BaseURL is the public origin share links (and the web's export routes) are
// built on: PRESENTATIONS_SHARE_BASE, else AUTH_PUBLIC_URL (the console's
// public origin, https://app.zekra.dev in production), else DefaultShareBase.
// A link is {base}/{locale}/p/{token}; the web app serves that route.
func BaseURL() string {
	for _, k := range []string{"PRESENTATIONS_SHARE_BASE", "AUTH_PUBLIC_URL"} {
		if v := strings.TrimRight(strings.TrimSpace(os.Getenv(k)), "/"); v != "" {
			return v
		}
	}
	return DefaultShareBase
}

// ShareURL is the page a customer opens.
func ShareURL(locale, token string) string {
	if !IsLocale(locale) {
		locale = "en"
	}
	return BaseURL() + "/" + locale + "/p/" + token
}

// DownloadURL is a file export through the same token.
func DownloadURL(locale, token, format string) string {
	return ShareURL(locale, token) + "/download/" + format
}

// ExportFormats lists the files each kind can be downloaded as.
func ExportFormats(kind string) []string {
	switch kind {
	case KindDeck:
		return []string{"pdf"}
	case KindReport:
		return []string{"pdf", "docx"}
	}
	return nil
}

// CreateShare issues a link for a document.
func (s *Store) CreateShare(ctx context.Context, id string, in PresentationShareInput, by string) (*PresentationShareCreated, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	doc, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	locale := in.Locale
	if locale == "" {
		locale = doc.Locale
	}
	if !IsLocale(locale) {
		return nil, InvalidError{"locale must be en or ar"}
	}
	if _, ok := doc.Content[locale]; !ok {
		return nil, InvalidError{"the document has no " + locale + " content yet; translate it first"}
	}
	if in.ExpiresInDays < 0 || in.ExpiresInDays > 3650 {
		return nil, InvalidError{"expires_in_days must be between 0 (never) and 3650"}
	}
	label := strings.TrimSpace(in.Label)
	if len([]rune(label)) > 80 {
		return nil, InvalidError{"label is at most 80 characters"}
	}
	token, err := NewToken()
	if err != nil {
		return nil, err
	}
	sealed := ""
	if sl := s.sealer(); sl.Configured() {
		if sealed, err = sl.Seal(token); err != nil {
			sealed = ""
		}
	}
	expires := "infinity"
	if in.ExpiresInDays > 0 {
		expires = time.Now().UTC().Add(time.Duration(in.ExpiresInDays) * 24 * time.Hour).Format(time.RFC3339)
	}
	shareID := newID()
	if _, err := d.ExecContext(ctx, `INSERT INTO presentation_shares
		(id, presentation_id, token_hash, token_sealed, token_hint, label, locale, expires_at, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9)`,
		shareID, doc.ID, HashToken(token), sealed, token[:4], label, locale, expires, by); err != nil {
		return nil, err
	}
	shares, err := s.ListShares(ctx, doc.ID)
	if err != nil {
		return nil, err
	}
	out := &PresentationShareCreated{Token: token, URL: ShareURL(locale, token), Recoverable: sealed != ""}
	for _, s := range shares {
		if s.ID == shareID {
			out.Share = s
			out.Share.URL = out.URL
		}
	}
	return out, nil
}

// ListShares lists a document's links, newest first.
func (s *Store) ListShares(ctx context.Context, id string) ([]PresentationShare, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := d.QueryContext(ctx, `SELECT id, presentation_id, label, locale, token_hint, token_sealed,
		CASE WHEN expires_at = 'infinity' THEN 'epoch'::timestamptz ELSE expires_at END,
		revoked_at, view_count, download_count, last_viewed_at, created_at,
		(revoked_at = 'epoch' AND expires_at > now())
		FROM presentation_shares WHERE presentation_id = $1 ORDER BY created_at DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sealer := s.sealer()
	out := []PresentationShare{}
	for rows.Next() {
		var s PresentationShare
		var sealed string
		var expires, revoked, viewed time.Time
		if err := rows.Scan(&s.ID, &s.PresentationID, &s.Label, &s.Locale, &s.Hint, &sealed,
			&expires, &revoked, &s.ViewCount, &s.DownloadCount, &viewed, &s.CreatedAt, &s.Active); err != nil {
			return nil, err
		}
		s.ExpiresAt = viewedPtr(expires)
		s.RevokedAt = viewedPtr(revoked)
		s.LastViewedAt = viewedPtr(viewed)
		if sealed != "" && s.Active {
			if token, err := sealer.Open(sealed); err == nil {
				s.URL = ShareURL(s.Locale, token)
			}
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// RevokeShare stops a link working. Revoking twice is not an error.
func (s *Store) RevokeShare(ctx context.Context, id, shareID string) error {
	d, err := s.db(ctx)
	if err != nil {
		return err
	}
	res, err := d.ExecContext(ctx, `UPDATE presentation_shares SET
		revoked_at = CASE WHEN revoked_at = 'epoch' THEN now() ELSE revoked_at END,
		token_sealed = ''
		WHERE id = $1 AND presentation_id = $2`, shareID, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// RevokeAll stops every link of a document; it returns how many were not yet
// revoked (expired ones included).
func (s *Store) RevokeAll(ctx context.Context, id string) (int64, error) {
	d, err := s.db(ctx)
	if err != nil {
		return 0, err
	}
	if _, err := s.Get(ctx, id); err != nil {
		return 0, err
	}
	res, err := d.ExecContext(ctx, `UPDATE presentation_shares SET revoked_at = now(), token_sealed = ''
		WHERE presentation_id = $1 AND revoked_at = 'epoch'`, id)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

type resolved struct {
	shareID string
	locale  string
	expires time.Time
	doc     *Presentation
}

// resolve turns a token into its document, or ErrLinkUnavailable.
func (s *Store) resolve(ctx context.Context, token string) (*resolved, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	if !validTokenShape(token) {
		return nil, ErrLinkUnavailable
	}
	var r resolved
	var docID string
	err = d.QueryRowContext(ctx, `SELECT id, presentation_id, locale,
		CASE WHEN expires_at = 'infinity' THEN 'epoch'::timestamptz ELSE expires_at END FROM presentation_shares
		WHERE token_hash = $1 AND revoked_at = 'epoch' AND expires_at > now()`, HashToken(token)).
		Scan(&r.shareID, &docID, &r.locale, &r.expires)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrLinkUnavailable
	}
	if err != nil {
		return nil, err
	}
	if r.doc, err = s.Get(ctx, docID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrLinkUnavailable
		}
		return nil, err
	}
	if r.doc.Status == "archived" {
		return nil, ErrLinkUnavailable
	}
	return &r, nil
}

// Events a public request records.
const (
	EventView     = "view"
	EventDownload = "download"
)

func (s *Store) record(ctx context.Context, r *resolved, event string) {
	d, err := s.db(ctx)
	if err != nil {
		return
	}
	switch event {
	case EventView:
		_, _ = d.ExecContext(ctx, `UPDATE presentation_shares SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1`, r.shareID)
		_, _ = d.ExecContext(ctx, `UPDATE presentations SET view_count = view_count + 1, last_viewed_at = now() WHERE id = $1`, r.doc.ID)
	case EventDownload:
		_, _ = d.ExecContext(ctx, `UPDATE presentation_shares SET download_count = download_count + 1 WHERE id = $1`, r.shareID)
		_, _ = d.ExecContext(ctx, `UPDATE presentations SET download_count = download_count + 1 WHERE id = $1`, r.doc.ID)
	}
}

// PublicPresentation is all a share link reveals.
type PublicPresentation struct {
	Kind     string         `json:"kind"`
	Title    string         `json:"title"`
	Customer string         `json:"customer"`
	Company  string         `json:"company"`
	Locale   string         `json:"locale"`
	Locales  []string       `json:"locales"`
	Style    string         `json:"style"`
	Content  map[string]any `json:"content"`
	// Page previews embedded by deck slides, by id, already stripped.
	Embeds    map[string]PublicEmbed `json:"embeds"`
	Formats   []string               `json:"formats"`
	ExpiresAt *time.Time             `json:"expires_at"`
	UpdatedAt time.Time              `json:"updated_at"`
}

// PublicEmbed is an embedded page preview.
type PublicEmbed struct {
	Style   string         `json:"style"`
	Content map[string]any `json:"content"`
}

// stripNotes removes owner-only fields from content, deeply.
func stripNotes(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if k == "notes" {
				continue
			}
			out[k] = stripNotes(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = stripNotes(val)
		}
		return out
	}
	return v
}

func pickLocale(doc *Presentation, want, fallback string) string {
	for _, l := range []string{want, fallback, doc.Locale, "en", "ar"} {
		if _, ok := doc.Content[l]; ok && l != "" {
			return l
		}
	}
	return doc.Locale
}

// OpenShared resolves a token and returns the read-only view, recording the
// event ("" records nothing).
func (s *Store) OpenShared(ctx context.Context, token, locale, event string) (*PublicPresentation, error) {
	r, err := s.resolve(ctx, token)
	if err != nil {
		return nil, err
	}
	doc := r.doc
	loc := pickLocale(doc, locale, r.locale)
	content, _ := stripNotes(doc.Content[loc]).(map[string]any)
	out := &PublicPresentation{Kind: doc.Kind, Title: titleOf(content), Customer: doc.Customer.Name,
		Company: doc.Customer.Company, Locale: loc, Locales: doc.Locales, Style: doc.Style, Content: content,
		Embeds: map[string]PublicEmbed{}, Formats: ExportFormats(doc.Kind), UpdatedAt: doc.UpdatedAt}
	if out.Title == "" {
		out.Title = doc.Title
	}
	out.ExpiresAt = viewedPtr(r.expires)
	if doc.Kind == KindDeck {
		for _, id := range embedIDs(content) {
			emb, err := s.Get(ctx, id)
			if err != nil || emb.Kind != KindPage || emb.Namespace != doc.Namespace {
				continue
			}
			ec, _ := stripNotes(emb.Content[pickLocale(emb, loc, "")]).(map[string]any)
			out.Embeds[id] = PublicEmbed{Style: emb.Style, Content: ec}
		}
	}
	if event != "" {
		s.record(ctx, r, event)
	}
	return out, nil
}

func embedIDs(content map[string]any) []string {
	var ids []string
	slides, _ := content["slides"].([]any)
	for _, s := range slides {
		m, _ := s.(map[string]any)
		if m["type"] == "embed" {
			if id, ok := m["document_id"].(string); ok {
				ids = append(ids, id)
			}
		}
	}
	return ids
}

// OpenSharedEmbed opens a page preview THROUGH a deck's share link: the token
// must be a live deck link and id must be a page the deck's content (in any of
// its locales) embeds. Anything else is ErrLinkUnavailable, exactly like an
// unknown token, so ids cannot be probed. Nothing is recorded.
func (s *Store) OpenSharedEmbed(ctx context.Context, token, id, locale string) (*PublicPresentation, error) {
	r, err := s.resolve(ctx, token)
	if err != nil {
		return nil, err
	}
	if r.doc.Kind != KindDeck || id == "" {
		return nil, ErrLinkUnavailable
	}
	embedded := false
	for _, c := range r.doc.Content {
		for _, e := range embedIDs(c) {
			if e == id {
				embedded = true
			}
		}
	}
	if !embedded {
		return nil, ErrLinkUnavailable
	}
	emb, err := s.Get(ctx, id)
	if err != nil || emb.Kind != KindPage || emb.Status == "archived" || emb.Namespace != r.doc.Namespace {
		return nil, ErrLinkUnavailable
	}
	loc := pickLocale(emb, locale, pickLocale(r.doc, locale, r.locale))
	content, _ := stripNotes(emb.Content[loc]).(map[string]any)
	out := &PublicPresentation{Kind: KindPage, Title: titleOf(content), Customer: r.doc.Customer.Name,
		Company: r.doc.Customer.Company, Locale: loc, Locales: emb.Locales, Style: emb.Style, Content: content,
		Embeds: map[string]PublicEmbed{}, Formats: []string{}, UpdatedAt: emb.UpdatedAt}
	if out.Title == "" {
		out.Title = emb.Title
	}
	out.ExpiresAt = viewedPtr(r.expires)
	return out, nil
}
