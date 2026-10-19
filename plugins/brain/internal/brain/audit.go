package brain

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

/*
Per-call audit log.

Every REST call made by an agent (an MCP tool call, an ACL token or an OAuth app)
writes one memory_events row with op 'call': the tool, route, status and latency,
plus who made it (agent, user, OAuth client, token name, MCP session). The
op-specific rows (retain, recall, search, …) carry the detail: the write decision,
the returned memory ids. Console clicks are not logged here; their reads are
covered by the op rows.

Query text is stored only when the caller owns the brain (see ownsBrain); every
query is also kept as a hash. ZEKRA_AUDIT_RETENTION_DAYS (0 or unset = keep)
deletes 'call' rows and strips stored query text after that many days.
*/

// auditable reports whether a request gets a 'call' row: agents only.
func auditable(a Activity) bool {
	return a.Tool != "" || a.Client == "token" || a.Client == "oauth"
}

// maxAuditPeek bounds how much of a JSON body is read to find the namespace.
const maxAuditPeek = 1 << 20

// auditCall runs h and logs the call.
func (s *Service) auditCall(w http.ResponseWriter, r *http.Request, h http.HandlerFunc) {
	start := time.Now()
	ns, query := peekCall(r)
	sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
	h(sw, r)
	route := r.URL.Path
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if p := rc.RoutePattern(); p != "" {
			route = p
		}
	}
	meta := map[string]any{"method": r.Method, "route": route, "status": sw.status}
	if query != "" {
		meta["query"] = clipRunes(query, 500)
	}
	outcome := "ok"
	switch {
	case sw.status == http.StatusUnauthorized || sw.status == http.StatusForbidden:
		outcome = "denied"
	case sw.status >= 400:
		outcome = "error"
	}
	// The client may be gone by now; the row is still written.
	ctx := context.WithoutCancel(r.Context())
	db, err := s.Store.db(ctx)
	if err != nil {
		return
	}
	s.Store.eventMeta(ctx, db, "call", ns, "", outcome, nil, int(time.Since(start).Milliseconds()), meta)
}

// peekCall finds the brain and query a call targets: the namespace / query (or
// q) URL parameters, else the same fields of a JSON body. The body is restored.
func peekCall(r *http.Request) (ns, query string) {
	q := r.URL.Query()
	ns = q.Get("namespace")
	if ns == "" {
		ns = chi.URLParam(r, "ns")
	}
	query = q.Get("query")
	if query == "" {
		query = q.Get("q")
	}
	if r.Body == nil || r.ContentLength <= 0 || r.ContentLength > maxAuditPeek ||
		!strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return ns, query
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxAuditPeek))
	r.Body = io.NopCloser(bytes.NewReader(raw))
	if err != nil {
		return ns, query
	}
	var body map[string]any
	if json.Unmarshal(raw, &body) != nil {
		return ns, query
	}
	if v, ok := body["namespace"].(string); ok && ns == "" {
		ns = v
	}
	if v, ok := body["query"].(string); ok && query == "" {
		query = v
	}
	return ns, query
}

// statusWriter records the response status. Flush passes through for streams.
type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if !w.wrote {
		w.status, w.wrote = code, true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	w.wrote = true
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// auditRetentionDays reads ZEKRA_AUDIT_RETENTION_DAYS (0 = keep forever).
func auditRetentionDays() int {
	n, err := strconv.Atoi(strings.TrimSpace(os.Getenv("ZEKRA_AUDIT_RETENTION_DAYS")))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// PurgeAudit deletes 'call' rows older than days and strips stored query text
// from older events (their query hash, results and counts stay, so stats keep
// working). It returns the rows deleted and the rows stripped.
func (s *Store) PurgeAudit(ctx context.Context, days int) (deleted, stripped int64, err error) {
	if days <= 0 {
		return 0, 0, nil
	}
	db, err := s.db(ctx)
	if err != nil {
		return 0, 0, err
	}
	cutoff := time.Now().AddDate(0, 0, -days)
	res, err := db.ExecContext(ctx, `DELETE FROM memory_events WHERE op='call' AND ts < $1`, cutoff)
	if err != nil {
		return 0, 0, err
	}
	deleted, _ = res.RowsAffected()
	res, err = db.ExecContext(ctx,
		`UPDATE memory_events SET metadata = metadata - 'query' WHERE ts < $1 AND metadata ? 'query'`, cutoff)
	if err != nil {
		return deleted, 0, err
	}
	stripped, _ = res.RowsAffected()
	return deleted, stripped, nil
}

// auditRetention purges on start-up and every six hours while a retention is set.
func (s *Service) auditRetention() {
	days := auditRetentionDays()
	if days == 0 {
		return
	}
	time.Sleep(time.Minute)
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		if d, st, err := s.Store.PurgeAudit(ctx, days); err != nil {
			log.Printf("brain: audit retention: %v", err)
		} else if d+st > 0 {
			log.Printf("brain: audit retention: %d call rows deleted, %d queries stripped", d, st)
		}
		cancel()
		time.Sleep(6 * time.Hour)
	}
}
