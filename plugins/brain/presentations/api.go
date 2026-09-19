package presentations

import (
	"context"
	"errors"
	"sync"
	"time"
)

/*
Transport-neutral response shapes shared by the REST handlers
(internal/brain/presentations_handlers.go) and the MCP tools, plus the public
share view's rate limiter. The HTTP surface itself lives in the brain plugin,
where the brain's caller/ACL model (sessions, brain_members, X-Zekra-Token
grants, OAuth scopes) and its CSRF rule apply.
*/

// PresentationList is the list page.
type PresentationList struct {
	Items []PresentationSummary `json:"items"`
}

// PresentationDetail is one document with its links.
type PresentationDetail struct {
	Presentation
	Shares  []PresentationShare `json:"shares"`
	Formats []string            `json:"formats"`
}

// PresentationCatalog is what a page preview may use, plus the content schemas.
type PresentationCatalog struct {
	Styles []StylePreset `json:"styles"`
	Scenes []SceneType   `json:"scenes"`
	Colors []string      `json:"colors"`
	// Icons are the only names an icon field accepts (kebab-case lucide).
	Icons []string `json:"icons"`
	// Blocks documents the workflow and screen blocks with an example each.
	Blocks  string                    `json:"blocks"`
	Schemas map[string]map[string]any `json:"schemas"`
}

// Catalog builds the page_styles answer.
func Catalog() PresentationCatalog {
	schemas := map[string]map[string]any{}
	for _, k := range Kinds {
		schemas[k] = ContentSchema(k)
	}
	return PresentationCatalog{Styles: StylePresets, Scenes: SceneTypes, Colors: ColorTokens, Icons: IconNames, Blocks: blockSummary(), Schemas: schemas}
}

// PresentationValidation is a dry-run result.
type PresentationValidation struct {
	Valid   bool           `json:"valid"`
	Errors  []FieldError   `json:"errors"`
	Content map[string]any `json:"content,omitempty"`
}

// Validate is a dry run for the editor.
func Validate(kind string, content map[string]any) PresentationValidation {
	norm, _, err := ValidateContent(kind, content)
	var ve *ValidationError
	if errors.As(err, &ve) {
		return PresentationValidation{Errors: ve.Errors}
	}
	return PresentationValidation{Valid: err == nil, Errors: []FieldError{}, Content: norm}
}

// Detail loads a document with its links.
func (s *Store) Detail(ctx context.Context, id string) (*PresentationDetail, error) {
	p, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	shares, err := s.ListShares(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	return &PresentationDetail{Presentation: *p, Shares: shares, Formats: ExportFormats(p.Kind)}, nil
}

// PresentationRevoked answers a revoke.
type PresentationRevoked struct {
	Revoked int64 `json:"revoked"`
}

// RegisterAPI mounts the owner routes and the public read.
// ---- rate limit -----------------------------------------------------------------

/*
Per client address: 120 public reads a minute, and 20 unknown tokens in ten
minutes (after which the address is refused for the rest of the window). A
token is 256 bits, so guessing is hopeless anyway; this keeps a scanner from
costing database round trips.
*/
type limiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	misses map[string][]time.Time
	now    func() time.Time
	pruned time.Time
}

func newLimiter() *limiter {
	return &limiter{hits: map[string][]time.Time{}, misses: map[string][]time.Time{}, now: time.Now}
}

const (
	hitWindow  = time.Minute
	hitLimit   = 120
	missWindow = 10 * time.Minute
	missLimit  = 20
)

func keep(list []time.Time, now time.Time, window time.Duration) []time.Time {
	out := list[:0]
	for _, t := range list {
		if now.Sub(t) < window {
			out = append(out, t)
		}
	}
	return out
}

func (l *limiter) allow(key string) bool {
	if key == "" {
		key = "unknown"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if now.Sub(l.pruned) > 5*time.Minute {
		for k, v := range l.hits {
			if len(keep(v, now, hitWindow)) == 0 {
				delete(l.hits, k)
			}
		}
		for k, v := range l.misses {
			if len(keep(v, now, missWindow)) == 0 {
				delete(l.misses, k)
			}
		}
		l.pruned = now
	}
	if len(keep(l.misses[key], now, missWindow)) >= missLimit {
		return false
	}
	h := keep(l.hits[key], now, hitWindow)
	if len(h) >= hitLimit {
		l.hits[key] = h
		return false
	}
	l.hits[key] = append(h, now)
	return true
}

func (l *limiter) miss(key string) {
	if key == "" {
		key = "unknown"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.misses[key] = append(keep(l.misses[key], l.now(), missWindow), l.now())
}

// Limiter is the public share view's per-address limiter.
type Limiter struct{ l *limiter }

// NewLimiter returns a fresh limiter (120 reads a minute, 20 unknown tokens in
// ten minutes per address).
func NewLimiter() *Limiter { return &Limiter{l: newLimiter()} }

// Allow records one read by key and reports whether it may proceed.
func (x *Limiter) Allow(key string) bool { return x.l.allow(key) }

// Miss records an unknown/revoked/expired token presented by key.
func (x *Limiter) Miss(key string) { x.l.miss(key) }
