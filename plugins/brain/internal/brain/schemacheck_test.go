package brain

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// --- pure units -----------------------------------------------------------------

func TestRequiredRelationsCoverNewTables(t *testing.T) {
	have := map[string]bool{}
	for _, r := range RequiredRelations() {
		have[r] = true
	}
	for _, want := range []string{"memories", "memory_events", "memory_conflicts", "memory_derivations", "notes"} {
		if !have[want] {
			t.Errorf("RequiredRelations() lacks %s: %v", want, RequiredRelations())
		}
	}
	ops := map[string]bool{}
	for _, op := range requiredEventOps() {
		ops[op] = true
	}
	for _, want := range []string{"retain", "conflict", "resolve_conflict", "stale", "call"} {
		if !ops[want] {
			t.Errorf("requiredEventOps() lacks %s: %v", want, requiredEventOps())
		}
	}
}

func TestUndefinedTableAnswersSchemaNotMigrated(t *testing.T) {
	err := fmt.Errorf("list: %w", &pgconn.PgError{Code: "42P01", Message: `relation "memory_conflicts" does not exist`})
	if !errors.Is(schemaErr(err), ErrSchemaNotMigrated) {
		t.Fatalf("42P01 not mapped: %v", schemaErr(err))
	}
	rec := httptest.NewRecorder()
	writeErr(rec, err)
	var body struct {
		Error struct{ Code, Message string }
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != 503 || body.Error.Code != "schema_not_migrated" {
		t.Fatalf("writeErr = %d %s", rec.Code, rec.Body)
	}
	if other := errors.New("boom"); schemaErr(other) != other {
		t.Fatal("unrelated errors must pass through")
	}
}

// --- database-backed ----------------------------------------------------------------

func TestSchemaDriftEmptyOnMigratedDatabase(t *testing.T) {
	f := newFix(t)
	db, _ := f.svc.Store.db(context.Background())
	d, err := SchemaDrift(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Empty() {
		t.Fatalf("a freshly migrated database drifts: %s", d)
	}
}

// list_conflicts, called over MCP like an agent does: an empty list (not null,
// not an error) on a brain with no conflicts, and the conflict once one exists.
func TestListConflictsToolEmptyThenListed(t *testing.T) {
	f := newOAuthFix(t)
	_, access, _ := f.fullFlow(ScopeRead+" "+ScopeWrite, f.writeNS())

	out, isErr := f.call(access, "list_conflicts", map[string]any{"namespace": f.brain})
	if isErr {
		t.Fatalf("list_conflicts on a fresh brain errored: %v", out)
	}
	list, ok := out["conflicts"].([]any)
	if !ok || len(list) != 0 {
		t.Fatalf("want conflicts: [], got %v", out)
	}

	a := f.seedMemory(f.brain, "the standup is at 09:30 cairo time")
	b := f.seedMemory(f.brain, "the standup is at 11:00 cairo time")
	f.exec(`INSERT INTO memory_conflicts (namespace, memory_a, memory_b, kind, reason, confidence, detector)
	        VALUES ($1, $2, $3, 'temporal', 'two standup times', 0.9, 'heuristic')`, f.brain, a, b)

	out, isErr = f.call(access, "list_conflicts", map[string]any{"namespace": f.brain})
	if isErr {
		t.Fatalf("list_conflicts errored: %v", out)
	}
	list, _ = out["conflicts"].([]any)
	if len(list) != 1 {
		t.Fatalf("want one conflict, got %v", out)
	}
	c := list[0].(map[string]any)
	ca, _ := c["a"].(map[string]any)
	cb, _ := c["b"].(map[string]any)
	if c["status"] != ConflictOpen || c["reason"] != "two standup times" || ca["id"] != a || cb["id"] != b {
		t.Fatalf("conflict = %v", c)
	}

	// Resolved conflicts leave the default (open) list but stay under status=all.
	f.exec(`UPDATE memory_conflicts SET status = 'both_valid_scoped' WHERE namespace = $1`, f.brain)
	out, _ = f.call(access, "list_conflicts", map[string]any{"namespace": f.brain})
	if list, _ = out["conflicts"].([]any); len(list) != 0 {
		t.Fatalf("resolved conflict still listed as open: %v", out)
	}
	out, _ = f.call(access, "list_conflicts", map[string]any{"namespace": f.brain, "status": "all"})
	if list, _ = out["conflicts"].([]any); len(list) != 1 {
		t.Fatalf("status=all: %v", out)
	}
}
