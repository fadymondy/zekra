package brain

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
)

/*
Activity telemetry: who did what, from which client, in which MCP session.

The Store never sees the HTTP request, so the REST layer (withCaller) and the MCP
endpoint put an Activity into the context and every memory_events row picks it up.
That is what lets the console answer "which AI recalled this, what did it ask,
which memories did it get back" (docs/ux/ZEKRA-CAPABILITY-GAPS.md S4–S6).

Each row also records the user, OAuth client, token name and MCP tool. Every
query is kept as a hash (query_hash); its text is stored only when the caller owns
the brain, and ZEKRA_LOG_RECALL_QUERIES=false turns the text off entirely. The
per-call audit rows are in audit.go.
*/

// Activity is the actor behind a store call.
type Activity struct {
	Agent       string // caller identity: oauth:<app>, token agent id, user:<uid>, …
	Client      string // oauth | token | console | local
	Session     string // MCP session id ("" outside MCP)
	User        string // the person behind the call (session user, OAuth grant owner)
	OAuthClient string // OAuth client id of a connected app
	Token       string // name (label) of the ACL token used
	Tool        string // MCP tool that made the call (X-Zekra-Tool)
}

type activityKey struct{}

// WithActivity stores the actor in the context. Empty fields of an Activity
// already in the context are kept (the MCP endpoint sets the session, the inner
// REST call sets the agent).
func WithActivity(ctx context.Context, a Activity) context.Context {
	prev := activityFrom(ctx)
	keep := func(f *string, old string) {
		if *f == "" {
			*f = old
		}
	}
	keep(&a.Agent, prev.Agent)
	keep(&a.Client, prev.Client)
	keep(&a.Session, prev.Session)
	keep(&a.User, prev.User)
	keep(&a.OAuthClient, prev.OAuthClient)
	keep(&a.Token, prev.Token)
	keep(&a.Tool, prev.Tool)
	return context.WithValue(ctx, activityKey{}, a)
}

// ownerKey holds the caller's "does it own this brain" check. Query text is
// only stored for calls into a brain the caller owns; everyone else's queries
// are kept as a hash.
type ownerKey struct{}

func withOwnerCheck(ctx context.Context, owns func(ctx context.Context, ns string) bool) context.Context {
	return context.WithValue(ctx, ownerKey{}, owns)
}

// ownsBrain reports whether the context's caller owns ns. A store call with no
// caller attached is the server itself (a sync job, a backfill) and counts as
// the owner.
func ownsBrain(ctx context.Context, ns string) bool {
	owns, _ := ctx.Value(ownerKey{}).(func(context.Context, string) bool)
	if owns == nil {
		return true
	}
	return owns(ctx, ns)
}

// queryHash is a stable fingerprint of a query (trimmed, lowercased), so the
// same question can be counted and matched without keeping its text.
func queryHash(q string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(q))))
	return hex.EncodeToString(sum[:16])
}

func activityFrom(ctx context.Context) Activity {
	a, _ := ctx.Value(activityKey{}).(Activity)
	return a
}

// clientKind classifies a resolved caller for telemetry.
func clientKind(c caller, r *http.Request) string {
	switch {
	case c.principal != nil:
		return "oauth"
	case TokenHeader(r.Header) != "":
		return "token"
	case c.session:
		return "console"
	default:
		return "local"
	}
}

// logRecallQueries reports whether recall/search query text is stored.
func logRecallQueries() bool {
	v := os.Getenv("ZEKRA_LOG_RECALL_QUERIES")
	return v != "0" && v != "false"
}

const maxLoggedResults = 20

// recallMeta is the metadata of a recall/search event: the query, what came
// back (ids, in rank order) and the top score of this ranking path.
func recallMeta(query string, rs []Recalled) map[string]any {
	m := map[string]any{"n": len(rs), "query_hash": queryHash(query)}
	if logRecallQueries() {
		m["query"] = clipRunes(query, 500)
	}
	if len(rs) > 0 {
		ids := make([]string, 0, min(len(rs), maxLoggedResults))
		seen := map[string]bool{}
		var nss []string
		for i, r := range rs {
			if i < maxLoggedResults {
				ids = append(ids, r.ID)
			}
			if r.Namespace != "" && !seen[r.Namespace] {
				seen[r.Namespace] = true
				nss = append(nss, r.Namespace)
			}
		}
		m["results"] = ids
		m["top"] = rs[0].Score
		if len(nss) > 0 {
			m["namespaces"] = nss
		}
	}
	return m
}

func clipRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// eventMeta writes one memory_events row with arbitrary metadata. The agent
// defaults to the context's actor; client/session are added when known.
func (s *Store) eventMeta(ctx context.Context, db *sql.DB, op, ns, agent, outcome string, memID any, ms int, meta map[string]any) {
	a := activityFrom(ctx)
	if agent == "" {
		agent = a.Agent
	}
	if meta == nil {
		meta = map[string]any{}
	}
	meta["outcome"] = outcome
	if a.Client != "" {
		meta["client"] = a.Client
	}
	for k, v := range map[string]string{"session": a.Session, "user": a.User,
		"oauth_client": a.OAuthClient, "token": a.Token, "tool": a.Tool} {
		if v != "" {
			meta[k] = v
		}
	}
	// Query text only for the brain's owner; the hash is always kept.
	if q, ok := meta["query"].(string); ok {
		if _, has := meta["query_hash"]; !has {
			meta["query_hash"] = queryHash(q)
		}
		if !logRecallQueries() || !ownsBrain(ctx, ns) {
			delete(meta, "query")
		}
	}
	raw, _ := json.Marshal(meta)
	_, _ = db.ExecContext(ctx,
		`INSERT INTO memory_events (namespace, op, memory_id, agent_id, latency_ms, metadata)
		 VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
		ns, op, memID, nullStr(agent), ms, string(raw))
}
