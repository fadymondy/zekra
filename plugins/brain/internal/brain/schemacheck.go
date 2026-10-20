package brain

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

/*
Schema drift check.

The API does not migrate its database at boot (DEPLOY.md, "schema before
binary"). When a change to schema.sql ships without the delta being applied,
the new binary answers every query on the missing table with SQLSTATE 42P01.
That is how list_conflicts and memory_provenance broke in production after
#59/#60: memory_conflicts and memory_derivations were never created there.

SchemaDrift compares what the embedded schema.sql declares with the live
database: every table it creates must exist, and memory_events_op_chk must
allow every op the code logs. The plugin logs the result at boot, and
`zekractl schema-check` exits non-zero on drift, so the gap is visible before
(or right after) a deploy instead of when an agent first calls the tool.
*/

var (
	createTableRe = regexp.MustCompile(`(?im)^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(`)
	eventOpsRe    = regexp.MustCompile(`(?is)memory_events_op_chk\s+CHECK\s*\(\s*op\s+IN\s*\(([^)]*)\)`)
	quotedRe      = regexp.MustCompile(`'([a-z_]+)'`)
)

// RequiredRelations lists the tables schema.sql creates in public, sorted.
func RequiredRelations() []string {
	seen := map[string]bool{}
	for _, m := range createTableRe.FindAllStringSubmatch(stripSQLComments(schemaSQL), -1) {
		seen[strings.ToLower(m[1])] = true
	}
	out := make([]string, 0, len(seen))
	for t := range seen {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// requiredEventOps is the op list of the LAST memory_events_op_chk definition
// in schema.sql (each later block widens the one before it).
func requiredEventOps() []string {
	all := eventOpsRe.FindAllStringSubmatch(stripSQLComments(schemaSQL), -1)
	if len(all) == 0 {
		return nil
	}
	var ops []string
	for _, q := range quotedRe.FindAllStringSubmatch(all[len(all)-1][1], -1) {
		ops = append(ops, q[1])
	}
	return ops
}

func stripSQLComments(s string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		if j := strings.Index(l, "--"); j >= 0 {
			lines[i] = l[:j]
		}
	}
	return strings.Join(lines, "\n")
}

// Drift is what the live database lacks compared to schema.sql.
type Drift struct {
	MissingRelations []string `json:"missingRelations,omitempty"`
	MissingEventOps  []string `json:"missingEventOps,omitempty"`
}

// Empty reports whether the database matches schema.sql (as far as checked).
func (d Drift) Empty() bool { return len(d.MissingRelations) == 0 && len(d.MissingEventOps) == 0 }

func (d Drift) String() string {
	var parts []string
	if len(d.MissingRelations) > 0 {
		parts = append(parts, "missing tables: "+strings.Join(d.MissingRelations, ", "))
	}
	if len(d.MissingEventOps) > 0 {
		parts = append(parts, "memory_events_op_chk lacks ops: "+strings.Join(d.MissingEventOps, ", "))
	}
	return strings.Join(parts, "; ")
}

// SchemaDrift compares the live database with the embedded schema.sql.
func SchemaDrift(ctx context.Context, db *sql.DB) (Drift, error) {
	var d Drift
	if db == nil {
		return d, fmt.Errorf("brain.SchemaDrift: nil db")
	}
	for _, t := range RequiredRelations() {
		var reg sql.NullString
		if err := db.QueryRowContext(ctx, `SELECT to_regclass('public.' || $1)::text`, t).Scan(&reg); err != nil {
			return d, err
		}
		if !reg.Valid {
			d.MissingRelations = append(d.MissingRelations, t)
		}
	}
	var def sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT pg_get_constraintdef(oid) FROM pg_constraint
		 WHERE conrelid = to_regclass('public.memory_events') AND conname = 'memory_events_op_chk'`).Scan(&def)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return d, err
	}
	if def.Valid {
		for _, op := range requiredEventOps() {
			if !strings.Contains(def.String, "'"+op+"'") {
				d.MissingEventOps = append(d.MissingEventOps, op)
			}
		}
	}
	return d, nil
}

// LogSchemaDrift runs SchemaDrift once and logs an error naming what is
// missing. It never blocks or fails the boot.
func (s *Service) LogSchemaDrift(ctx context.Context) {
	if s.k == nil || s.k.Log == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	db, err := s.Store.db(ctx)
	if err != nil {
		return
	}
	d, err := SchemaDrift(ctx, db)
	if err != nil {
		s.k.Log.Warn("brain: schema drift check failed", "err", err)
		return
	}
	if !d.Empty() {
		s.k.Log.Error("brain: database schema is behind schema.sql; apply the delta (DEPLOY.md, schema before binary)",
			"missingRelations", d.MissingRelations, "missingEventOps", d.MissingEventOps)
	}
}

// ErrSchemaNotMigrated marks a query that hit a table or column the live
// database does not have yet (SQLSTATE 42P01 / 42703).
var ErrSchemaNotMigrated = errors.New("brain: database schema not migrated")

// schemaErr wraps an undefined-table/column error as ErrSchemaNotMigrated so
// handlers can answer with an actionable message instead of a bare SQL error.
func schemaErr(err error) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && (pe.Code == "42P01" || pe.Code == "42703") {
		return fmt.Errorf("%w: %s (run `zekractl migrate` or apply the schema.sql delta)", ErrSchemaNotMigrated, pe.Message)
	}
	return err
}
