// Package schema owns the account tables (internal/account) the way the brain
// plugin owns its schema.sql: an embedded, idempotent DDL file applied by
// Migrate. Kept dependency-free (database/sql only) so ops tools such as
// zekractl can apply it without booting the kernel.
package schema

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"strings"
)

//go:embed schema.sql
var ddl string

// SQL exposes the embedded DDL (for inspection / external migration).
func SQL() string { return ddl }

// Migrate applies the account schema. Idempotent: every statement is IF NOT EXISTS.
func Migrate(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return errors.New("account schema: no database")
	}
	if _, err := db.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("account schema: %w", err)
	}
	return nil
}

// AdminEmails parses ADMIN_EMAILS (comma-separated, case-insensitive).
func AdminEmails() []string {
	out := []string{}
	for _, e := range strings.Split(os.Getenv("ADMIN_EMAILS"), ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			out = append(out, e)
		}
	}
	return out
}

// Promote adds role to the account with email (case-insensitive). It reports
// whether an account matched. Existing roles are kept; the role is not duplicated.
func Promote(ctx context.Context, db *sql.DB, email, role string) (bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || role == "" {
		return false, errors.New("email and role are required")
	}
	rows, err := db.QueryContext(ctx, `SELECT id, COALESCE(roles,'') FROM users WHERE lower(email) = $1`, email)
	if err != nil {
		return false, err
	}
	type acct struct{ id, roles string }
	var found []acct
	for rows.Next() {
		var a acct
		if err := rows.Scan(&a.id, &a.roles); err != nil {
			rows.Close()
			return false, err
		}
		found = append(found, a)
	}
	rows.Close()
	for _, a := range found {
		roles := AddRole(a.roles, role)
		if roles == a.roles {
			continue
		}
		if _, err := db.ExecContext(ctx, `UPDATE users SET roles = $1 WHERE id = $2`, roles, a.id); err != nil {
			return false, err
		}
	}
	return len(found) > 0, nil
}

// AddRole returns the roles CSV with role added (once).
func AddRole(csv, role string) string {
	out := []string{}
	for _, r := range strings.Split(csv, ",") {
		if r = strings.TrimSpace(r); r != "" {
			if r == role {
				return csv
			}
			out = append(out, r)
		}
	}
	return strings.Join(append(out, role), ",")
}
