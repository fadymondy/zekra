package brain

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
)

/*
Activity telemetry: who did what, from which client, in which MCP session.

The Store never sees the HTTP request, so the REST layer (withCaller) and the MCP
endpoint put an Activity into the context and every memory_events row picks it up.
That is what lets the console answer "which AI recalled this, what did it ask,
which memories did it get back" (docs/ux/ZEKRA-CAPABILITY-GAPS.md S4–S6).

Recall queries are stored text. They stay inside the brain's own event rows (read
access = brain read access) and ZEKRA_LOG_RECALL_QUERIES=false turns them off.
*/

// Activity is the actor behind a store call.
type Activity struct {
	Agent   string // caller identity: oauth:<app>, token agent id, user:<uid>, …
	Client  string // oauth | token | console | local
	Session string // MCP session id ("" outside MCP)
}

type activityKey struct{}

// WithActivity stores the actor in the context. Empty fields of an Activity
// already in the context are kept (the MCP endpoint sets the session, the inner
// REST call sets the agent).
func WithActivity(ctx context.Context, a Activity) context.Context {
	prev := activityFrom(ctx)
	if a.Agent == "" {
		a.Agent = prev.Agent
	}
	if a.Client == "" {
		a.Client = prev.Client
	}
	if a.Session == "" {
		a.Session = prev.Session
	}
	return context.WithValue(ctx, activityKey{}, a)
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
	m := map[string]any{"n": len(rs)}
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
	if a.Session != "" {
		meta["session"] = a.Session
	}
	raw, _ := json.Marshal(meta)
	_, _ = db.ExecContext(ctx,
		`INSERT INTO memory_events (namespace, op, memory_id, agent_id, latency_ms, metadata)
		 VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
		ns, op, memID, nullStr(agent), ms, string(raw))
}
