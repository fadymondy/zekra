/*
Package presentations is Zekra's presentation layer, ported from
fadymondy.com (FM-341/342): decks, long-form reports and page previews, each
personalised for one customer, authored mostly over MCP and shown to the
customer through a revocable share link.

Every document belongs to one brain (namespace) and records the account that
created it (owner_user_id). This package is tenancy-aware but not
access-aware: the brain plugin's HTTP layer (internal/brain/presentations*.go)
decides who may read or write a namespace, exactly as it does for notes, and
calls in here. Everything is owner-side except what share.go returns for a
valid share token: a read-only view without speaker notes, the customer's
email or anything about other documents.
*/
package presentations

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Store is the presentations data layer over the brain's Postgres.
type Store struct {
	// DB resolves the database handle (the kernel's pool in production).
	DB func(ctx context.Context) (*sql.DB, error)
	// Translator serves presentation_translate; nil = none configured
	// (ErrNoTranslator, and the MCP caller translates with its own model).
	Translator Translator
	// Sealer keeps share tokens recoverable for the owner; nil = DefaultSealer().
	Sealer Sealer
}

// NewStore returns a Store on the given handle resolver.
func NewStore(db func(ctx context.Context) (*sql.DB, error)) *Store {
	return &Store{DB: db}
}

func (s *Store) db(ctx context.Context) (*sql.DB, error) {
	if s == nil || s.DB == nil {
		return nil, ErrNoDB
	}
	d, err := s.DB(ctx)
	if err != nil || d == nil {
		return nil, ErrNoDB
	}
	return d, nil
}

func (s *Store) sealer() Sealer {
	if s != nil && s.Sealer != nil {
		return s.Sealer
	}
	return DefaultSealer()
}

// pgTextArray renders a Postgres text[] literal (driver-agnostic, like the
// brain's stringArray).
func pgTextArray(list []string) string {
	var b strings.Builder
	b.WriteByte('{')
	for i, v := range list {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		b.WriteString(strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v))
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String()
}

// Statuses.
var Statuses = []string{"draft", "ready", "archived"}

// Errors callers branch on.
var (
	ErrNotFound = errors.New("presentation not found")
	ErrNoDB     = errors.New("no database configured")
)

// InvalidError is a plain bad-input error (not a content validation).
type InvalidError struct{ Msg string }

func (e InvalidError) Error() string { return e.Msg }

// PresentationCustomer is who a document is for.
type PresentationCustomer struct {
	Name    string `json:"name" required:"false"`
	Company string `json:"company" required:"false"`
	Email   string `json:"email,omitempty"`
}

// Presentation is one document, as the owner sees it.
type Presentation struct {
	ID            string                    `json:"id"`
	Namespace     string                    `json:"namespace"`
	OwnerUserID   string                    `json:"owner_user_id"`
	CreatedBy     string                    `json:"created_by"`
	Kind          string                    `json:"kind"`
	Title         string                    `json:"title"`
	Customer      PresentationCustomer      `json:"customer"`
	Locale        string                    `json:"locale"`
	Locales       []string                  `json:"locales"`
	Status        string                    `json:"status"`
	Style         string                    `json:"style"`
	Content       map[string]map[string]any `json:"content"`
	Translations  map[string]any            `json:"translations"`
	ViewCount     int64                     `json:"view_count"`
	DownloadCount int64                     `json:"download_count"`
	LastViewedAt  *time.Time                `json:"last_viewed_at"`
	ActiveShares  int                       `json:"active_shares"`
	CreatedAt     time.Time                 `json:"created_at"`
	UpdatedAt     time.Time                 `json:"updated_at"`
}

// PresentationSummary is a list row: everything but the content.
type PresentationSummary struct {
	ID            string               `json:"id"`
	Namespace     string               `json:"namespace"`
	OwnerUserID   string               `json:"owner_user_id"`
	Kind          string               `json:"kind"`
	Title         string               `json:"title"`
	Customer      PresentationCustomer `json:"customer"`
	Locale        string               `json:"locale"`
	Locales       []string             `json:"locales"`
	Status        string               `json:"status"`
	Style         string               `json:"style"`
	ViewCount     int64                `json:"view_count"`
	DownloadCount int64                `json:"download_count"`
	LastViewedAt  *time.Time           `json:"last_viewed_at"`
	ActiveShares  int                  `json:"active_shares"`
	UpdatedAt     time.Time            `json:"updated_at"`
}

// PresentationInput creates or updates a document. On update, nil/empty
// fields are left alone; Content replaces the given locale's content only.
type PresentationInput struct {
	// Namespace is the brain the document is created in (create only: a
	// document never moves between brains).
	Namespace string `json:"namespace,omitempty"`
	// OwnerUserID is the creating account; set by the server, never the body.
	OwnerUserID string                `json:"-"`
	Kind        string                `json:"kind,omitempty"`
	Title       *string               `json:"title,omitempty"`
	Customer    *PresentationCustomer `json:"customer,omitempty"`
	Locale      string                `json:"locale,omitempty"`
	Status      string                `json:"status,omitempty"`
	Style       string                `json:"style,omitempty"`
	Content     map[string]any        `json:"content,omitempty"`
}

// PresentationFilter narrows a list. Namespaces limits it to those brains;
// All lifts the limit (admins). Neither = nothing (fail closed).
type PresentationFilter struct {
	Namespaces []string
	All        bool
	Query      string
	Kind       string
	Customer   string
	Status     string
	Limit      int
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

var epoch = time.Unix(0, 0).UTC()

func viewedPtr(t time.Time) *time.Time {
	if !t.After(epoch) {
		return nil
	}
	return &t
}

func localesOf(content map[string]map[string]any) []string {
	var out []string
	for _, l := range Locales {
		if _, ok := content[l]; ok {
			out = append(out, l)
		}
	}
	return out
}

func cleanCustomer(c PresentationCustomer) (PresentationCustomer, error) {
	c.Name = strings.TrimSpace(c.Name)
	c.Company = strings.TrimSpace(c.Company)
	c.Email = strings.TrimSpace(c.Email)
	switch {
	case c.Name == "" && c.Company == "":
		return c, InvalidError{"customer: a name or a company is required"}
	case len(c.Name) > 120 || len(c.Company) > 120:
		return c, InvalidError{"customer: name and company are at most 120 characters"}
	case c.Email != "" && (len(c.Email) > 200 || !strings.Contains(c.Email, "@") || strings.ContainsAny(c.Email, " <>\n")):
		return c, InvalidError{"customer.email: not an email address"}
	}
	return c, nil
}

// checkEmbeds confirms every embed points at an existing page preview in the
// same brain: a share link reveals its embeds, so a cross-brain embed would
// leak another brain's document.
func checkEmbeds(ctx context.Context, d *sql.DB, ns string, ids []string, self string) error {
	var errs []FieldError
	for _, id := range ids {
		var kind string
		err := d.QueryRowContext(ctx, `SELECT kind FROM presentations WHERE id = $1 AND namespace = $2`, id, ns).Scan(&kind)
		switch {
		case id == self:
			errs = append(errs, FieldError{Path: "embed.document_id", Message: "a document cannot embed itself"})
		case errors.Is(err, sql.ErrNoRows):
			errs = append(errs, FieldError{Path: "embed.document_id", Message: fmt.Sprintf("no document %q", id)})
		case err != nil:
			return err
		case kind != KindPage:
			errs = append(errs, FieldError{Path: "embed.document_id", Message: fmt.Sprintf("%q is a %s; only page previews can be embedded", id, kind)})
		}
	}
	if len(errs) > 0 {
		return &ValidationError{Errors: errs}
	}
	return nil
}

const selectCols = `id, namespace, COALESCE(owner_user_id, ''), created_by, kind,title, customer_name, customer_company, customer_email, locale, status, style,
	content, translations, view_count, download_count, last_viewed_at, created_at, updated_at,
	(SELECT COUNT(*) FROM presentation_shares s WHERE s.presentation_id = presentations.id
	   AND s.revoked_at = 'epoch' AND s.expires_at > now())`

type scanner interface{ Scan(dest ...any) error }

func scanDoc(row scanner) (*Presentation, error) {
	var p Presentation
	var content, translations []byte
	var viewed time.Time
	if err := row.Scan(&p.ID, &p.Namespace, &p.OwnerUserID, &p.CreatedBy, &p.Kind, &p.Title, &p.Customer.Name, &p.Customer.Company, &p.Customer.Email,
		&p.Locale, &p.Status, &p.Style, &content, &translations, &p.ViewCount, &p.DownloadCount, &viewed,
		&p.CreatedAt, &p.UpdatedAt, &p.ActiveShares); err != nil {
		return nil, err
	}
	p.Content = map[string]map[string]any{}
	p.Translations = map[string]any{}
	_ = json.Unmarshal(content, &p.Content)
	_ = json.Unmarshal(translations, &p.Translations)
	p.Locales = localesOf(p.Content)
	p.LastViewedAt = viewedPtr(viewed)
	return &p, nil
}

// Get loads one document.
func (s *Store) Get(ctx context.Context, id string) (*Presentation, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	p, err := scanDoc(d.QueryRowContext(ctx, `SELECT `+selectCols+` FROM presentations WHERE id = $1`, strings.TrimSpace(id)))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// List returns summaries, newest first.
func (s *Store) List(ctx context.Context, f PresentationFilter) ([]PresentationSummary, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if !f.All {
		if len(f.Namespaces) == 0 {
			return []PresentationSummary{}, nil
		}
		where = append(where, "namespace = ANY("+arg(pgTextArray(f.Namespaces))+"::text[])")
	}
	if f.Kind != "" {
		if !contains(Kinds, f.Kind) {
			return nil, InvalidError{"kind must be deck, report or page"}
		}
		where = append(where, "kind = "+arg(f.Kind))
	}
	if f.Status != "" {
		if !contains(Statuses, f.Status) {
			return nil, InvalidError{"status must be draft, ready or archived"}
		}
		where = append(where, "status = "+arg(f.Status))
	}
	if c := strings.TrimSpace(f.Customer); c != "" {
		p := arg("%" + escapeLike(strings.ToLower(c)) + "%")
		where = append(where, "(lower(customer_name) LIKE "+p+" OR lower(customer_company) LIKE "+p+")")
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		p := arg("%" + escapeLike(strings.ToLower(q)) + "%")
		where = append(where, "(lower(title) LIKE "+p+" OR lower(customer_name) LIKE "+p+" OR lower(customer_company) LIKE "+p+" OR id = "+arg(q)+")")
	}
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	q := `SELECT ` + selectCols + ` FROM presentations`
	if len(where) > 0 {
		q += " WHERE " + strings.Join(where, " AND ")
	}
	q += fmt.Sprintf(" ORDER BY updated_at DESC LIMIT %d", limit)
	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PresentationSummary{}
	for rows.Next() {
		p, err := scanDoc(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, PresentationSummary{ID: p.ID, Namespace: p.Namespace, OwnerUserID: p.OwnerUserID, Kind: p.Kind, Title: p.Title, Customer: p.Customer,
			Locale: p.Locale, Locales: p.Locales, Status: p.Status, Style: p.Style, ViewCount: p.ViewCount,
			DownloadCount: p.DownloadCount, LastViewedAt: p.LastViewedAt, ActiveShares: p.ActiveShares, UpdatedAt: p.UpdatedAt})
	}
	return out, rows.Err()
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func titleOf(content map[string]any) string {
	t, _ := content["title"].(string)
	return strings.TrimSpace(t)
}

// Create validates and stores a new document.
func (s *Store) Create(ctx context.Context, in PresentationInput, by string) (*Presentation, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	in.Namespace = strings.TrimSpace(in.Namespace)
	if in.Namespace == "" {
		return nil, InvalidError{"namespace is required: the brain the document belongs to"}
	}
	if !contains(Kinds, in.Kind) {
		return nil, InvalidError{"kind must be deck, report or page"}
	}
	if in.Locale == "" {
		in.Locale = "en"
	}
	if !IsLocale(in.Locale) {
		return nil, InvalidError{"locale must be en or ar"}
	}
	if in.Status == "" {
		in.Status = "draft"
	}
	if !contains(Statuses, in.Status) {
		return nil, InvalidError{"status must be draft, ready or archived"}
	}
	if in.Customer == nil {
		return nil, InvalidError{"customer is required: {name, company, email?}"}
	}
	cust, err := cleanCustomer(*in.Customer)
	if err != nil {
		return nil, err
	}
	style, err := styleFor(in.Kind, in.Style)
	if err != nil {
		return nil, err
	}
	content, embeds, err := ValidateContent(in.Kind, in.Content)
	if err != nil {
		return nil, err
	}
	id := newID()
	if err := checkEmbeds(ctx, d, in.Namespace, embeds, id); err != nil {
		return nil, err
	}
	title := titleOf(content)
	if in.Title != nil && strings.TrimSpace(*in.Title) != "" {
		title = strings.TrimSpace(*in.Title)
	}
	body, _ := json.Marshal(map[string]any{in.Locale: content})
	if _, err := d.ExecContext(ctx, `INSERT INTO presentations
		(id, namespace, owner_user_id, kind, title, customer_name, customer_company, customer_email, locale, status, style, content, created_by)
		VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, in.Namespace, in.OwnerUserID, in.Kind, title, cust.Name, cust.Company, cust.Email, in.Locale, in.Status, style, body, by); err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func styleFor(kind, style string) (string, error) {
	style = strings.TrimSpace(style)
	if kind != KindPage {
		if style != "" {
			return "", InvalidError{"style applies to page previews only"}
		}
		return "", nil
	}
	if style == "" {
		return "minimal", nil
	}
	if !IsStyle(style) {
		return "", InvalidError{"style must be one of: minimal, bold, editorial, tech-dark (see page_styles)"}
	}
	return style, nil
}

// Update changes a document. Content, when given, replaces the content of
// in.Locale (default: the document's locale) only.
func (s *Store) Update(ctx context.Context, id string, in PresentationInput) (*Presentation, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	cur, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if in.Kind != "" && in.Kind != cur.Kind {
		return nil, InvalidError{"kind cannot be changed; create a new document"}
	}
	title, status, style, cust := cur.Title, cur.Status, cur.Style, cur.Customer
	if in.Title != nil {
		title = strings.TrimSpace(*in.Title)
	}
	if in.Status != "" {
		if !contains(Statuses, in.Status) {
			return nil, InvalidError{"status must be draft, ready or archived"}
		}
		status = in.Status
	}
	if in.Style != "" {
		if style, err = styleFor(cur.Kind, in.Style); err != nil {
			return nil, err
		}
	}
	if in.Customer != nil {
		if cust, err = cleanCustomer(*in.Customer); err != nil {
			return nil, err
		}
	}
	content := cur.Content
	translations := cur.Translations
	if in.Content != nil {
		loc := in.Locale
		if loc == "" {
			loc = cur.Locale
		}
		if !IsLocale(loc) {
			return nil, InvalidError{"locale must be en or ar"}
		}
		norm, embeds, err := ValidateContent(cur.Kind, in.Content)
		if err != nil {
			return nil, err
		}
		if err := checkEmbeds(ctx, d, cur.Namespace, embeds, cur.ID); err != nil {
			return nil, err
		}
		content[loc] = norm
		// Content written by hand for this locale is no longer a machine translation.
		delete(translations, loc)
		if in.Title == nil && loc == cur.Locale {
			title = titleOf(norm)
		}
	} else if in.Locale != "" && in.Locale != cur.Locale {
		// Switching the primary language needs content in it.
		if !IsLocale(in.Locale) {
			return nil, InvalidError{"locale must be en or ar"}
		}
		if _, ok := content[in.Locale]; !ok {
			return nil, InvalidError{"there is no " + in.Locale + " content to make primary; translate first"}
		}
	}
	primary := cur.Locale
	if in.Content == nil && in.Locale != "" {
		primary = in.Locale
	}
	body, _ := json.Marshal(content)
	tr, _ := json.Marshal(translations)
	if _, err := d.ExecContext(ctx, `UPDATE presentations SET title=$2, customer_name=$3, customer_company=$4,
		customer_email=$5, status=$6, style=$7, content=$8, translations=$9, locale=$10, updated_at=now() WHERE id=$1`,
		cur.ID, title, cust.Name, cust.Company, cust.Email, status, style, body, tr, primary); err != nil {
		return nil, err
	}
	return s.Get(ctx, cur.ID)
}

// SetTranslation stores machine- or model-translated content for a locale.
func (s *Store) SetTranslation(ctx context.Context, id, locale string, content map[string]any, provenance map[string]any) (*Presentation, error) {
	d, err := s.db(ctx)
	if err != nil {
		return nil, err
	}
	cur, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	norm, embeds, err := ValidateContent(cur.Kind, content)
	if err != nil {
		return nil, err
	}
	if err := checkEmbeds(ctx, d, cur.Namespace, embeds, cur.ID); err != nil {
		return nil, err
	}
	cur.Content[locale] = norm
	cur.Translations[locale] = provenance
	body, _ := json.Marshal(cur.Content)
	tr, _ := json.Marshal(cur.Translations)
	if _, err := d.ExecContext(ctx, `UPDATE presentations SET content=$2, translations=$3, updated_at=now() WHERE id=$1`,
		cur.ID, body, tr); err != nil {
		return nil, err
	}
	return s.Get(ctx, cur.ID)
}

// Delete removes a document and its share links.
func (s *Store) Delete(ctx context.Context, id string) error {
	d, err := s.db(ctx)
	if err != nil {
		return err
	}
	res, err := d.ExecContext(ctx, `DELETE FROM presentations WHERE id = $1`, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}
