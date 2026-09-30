package circlexo

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
)

//go:embed schema.sql
var ddl string

// SQL exposes the embedded DDL (for inspection / external migration).
func SQL() string { return ddl }

// Migrate applies the integration's tables. Idempotent.
func Migrate(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return errors.New("circlexo schema: no database")
	}
	if _, err := db.ExecContext(ctx, ddl); err != nil {
		return fmt.Errorf("circlexo schema: %w", err)
	}
	return nil
}
