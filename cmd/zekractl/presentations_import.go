package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/togo-framework/brain/presentations"
)

/*
zekractl presentations-import <file.json | --from-postgres DSN> --namespace <ns> --owner <email>

	[--owner-id <user id>] [--dry-run]

Copies fadymondy.com's presentations / presentation_shares into one Zekra brain
(DATABASE_URL), preserving ids, share token_hash / token_sealed / token_hint and
counters (plugins/brain/presentations/import.go). The source is READ ONLY: a
JSON export, or a DSN read inside a READ ONLY transaction. Re-running is a
no-op. --owner resolves the account by email in the Zekra users table.
*/
func presentationsImport(db *sql.DB, args []string) {
	var file, srcDSN, ns, owner, ownerID string
	dry := false
	for i := 0; i < len(args); i++ {
		next := func() string {
			if i+1 >= len(args) {
				fatal("missing value for " + args[i])
			}
			i++
			return args[i]
		}
		switch a := args[i]; {
		case a == "--from-postgres":
			srcDSN = next()
		case a == "--namespace":
			ns = next()
		case a == "--owner":
			owner = next()
		case a == "--owner-id":
			ownerID = next()
		case a == "--dry-run":
			dry = true
		case strings.HasPrefix(a, "--"):
			fatal("unknown flag " + a)
		default:
			file = a
		}
	}
	usage := "usage: zekractl presentations-import <file.json|--from-postgres DSN> --namespace <ns> --owner <email> [--owner-id <id>] [--dry-run]"
	if (file == "") == (srcDSN == "") || ns == "" || (owner == "" && ownerID == "") {
		fatal(usage)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if ownerID == "" {
		rows, err := db.QueryContext(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, strings.TrimSpace(owner))
		must(err, "look up the owner")
		var ids []string
		for rows.Next() {
			var id string
			must(rows.Scan(&id), "scan owner")
			ids = append(ids, id)
		}
		rows.Close()
		switch len(ids) {
		case 0:
			fatal("no Zekra account with email " + owner + " (register it first, or pass --owner-id)")
		case 1:
			ownerID = ids[0]
		default:
			fatal("several accounts share that email; pass --owner-id")
		}
	}

	var exp *presentations.SourceExport
	if file != "" {
		raw, err := os.ReadFile(file)
		must(err, "read "+file)
		exp, err = presentations.ParseExport(raw)
		must(err, "parse "+file)
	} else {
		src, err := sql.Open("pgx", srcDSN)
		must(err, "open the source")
		defer src.Close()
		exp, err = presentations.ReadSource(ctx, src) // READ ONLY transaction, SELECT only
		must(err, "read the source")
	}

	st := presentations.NewStore(func(context.Context) (*sql.DB, error) { return db, nil })
	res, err := st.Import(ctx, exp, ns, ownerID, dry)
	must(err, "import")
	out, _ := json.MarshalIndent(res, "", "  ")
	if dry {
		fmt.Println("dry run (nothing written):")
	}
	fmt.Println(string(out))
	fmt.Printf("✓ %d presentations and %d share links into brain %q (owner %s); %d links copyable again here\n",
		res.Presentations, res.Shares, ns, ownerID, res.Recoverable)
	if res.Shares > res.Recoverable {
		fmt.Println("  links that are not copyable still OPEN at {PRESENTATIONS_SHARE_BASE}/{locale}/p/{token} (same sha256);")
		fmt.Println("  to copy them again, set VAULT_KEY to fadymondy.com's VAULT_KEY here.")
	}
}
