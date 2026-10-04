package brain

import (
	"context"
	"strings"
	"testing"
)

func TestWithActivityMergesLayers(t *testing.T) {
	// The MCP endpoint knows the session; the inner REST call knows the agent.
	ctx := WithActivity(context.Background(), Activity{Session: "s1"})
	ctx = WithActivity(ctx, Activity{Agent: "oauth:Claude", Client: "oauth"})
	got := activityFrom(ctx)
	if got != (Activity{Agent: "oauth:Claude", Client: "oauth", Session: "s1"}) {
		t.Fatalf("merged activity = %+v", got)
	}
}

func TestRecallMeta(t *testing.T) {
	t.Setenv("ZEKRA_LOG_RECALL_QUERIES", "")
	rs := make([]Recalled, 25)
	for i := range rs {
		rs[i] = Recalled{ID: string(rune('a' + i)), Score: float64(25 - i), Namespace: "flowos"}
	}
	m := recallMeta(strings.Repeat("q", 600), rs)
	if n := len(m["results"].([]string)); n != maxLoggedResults {
		t.Fatalf("results logged = %d, want %d", n, maxLoggedResults)
	}
	if m["n"] != 25 || m["top"] != 25.0 {
		t.Fatalf("n/top = %v/%v", m["n"], m["top"])
	}
	if q := m["query"].(string); len(q) != 500 {
		t.Fatalf("query not clipped: %d", len(q))
	}
	if nss := m["namespaces"].([]string); len(nss) != 1 || nss[0] != "flowos" {
		t.Fatalf("namespaces = %v", nss)
	}

	t.Setenv("ZEKRA_LOG_RECALL_QUERIES", "false")
	if _, ok := recallMeta("secret question", nil)["query"]; ok {
		t.Fatal("query logged with ZEKRA_LOG_RECALL_QUERIES=false")
	}
}
