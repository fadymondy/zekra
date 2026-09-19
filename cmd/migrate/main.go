// Command migrate applies the SQL schema files (internal/db/schema/*.sql) to the
// database. Driver-agnostic via the app's database/sql handle. Run with `togo migrate`.
package main

import (
	"context"
	"os"
	"path/filepath"
	"sort"

	"github.com/togo-framework/togo"

	accountschema "github.com/fadymondy/zekra/internal/account/schema"
	"github.com/fadymondy/zekra/internal/app"
	// Registers the installed plugins — including db-postgres, which provides the
	// "pgx" database/sql driver. Without it k.SQL fails with: unknown driver "pgx".
	_ "github.com/fadymondy/zekra/internal/plugins"
)

func main() {
	k := togo.New()
	ctx := context.Background()
	a := app.New(ctx, k)
	defer k.Close()

	sqlDB, err := k.SQL(ctx)
	if err != nil {
		k.Log.Error("migrate: database unavailable", "err", err)
		os.Exit(1)
	}
	_ = a

	files, _ := filepath.Glob("internal/db/schema/*.sql")
	sort.Strings(files)
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			k.Log.Error("migrate: read failed", "file", f, "err", err)
			os.Exit(1)
		}
		if _, err := sqlDB.ExecContext(ctx, string(b)); err != nil {
			k.Log.Error("migrate failed", "file", filepath.Base(f), "err", err)
			os.Exit(1)
		}
		k.Log.Info("applied", "file", filepath.Base(f))
	}
	// The account tables (internal/account/schema/schema.sql) — Postgres only.
	if drv := k.Config.DBDriver; drv == "pgx" || drv == "postgres" {
		if err := accountschema.Migrate(ctx, sqlDB); err != nil {
			k.Log.Error("migrate failed", "file", "account schema", "err", err)
			os.Exit(1)
		}
		k.Log.Info("applied", "file", "internal/account/schema/schema.sql")
	}
	k.Log.Info("migrate complete")
}
