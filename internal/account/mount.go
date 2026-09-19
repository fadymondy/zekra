package account

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/zekra/internal/account/schema"
)

// Mount wires the account backend onto the kernel: schema, middleware, routes,
// the auth.login hook and the background purger/sweeper. It returns nil (and
// changes nothing) when the auth plugin or a Postgres database is missing, so
// the auth plugin's own routes keep working either way.
func Mount(ctx context.Context, k *togo.Kernel, api huma.API, db *sql.DB) *Service {
	log := k.Log
	svc, ok := auth.FromKernel(k)
	if !ok || svc == nil {
		log.Warn("accounts: auth plugin not registered — account routes not mounted")
		return nil
	}
	if drv := strings.ToLower(k.Config.DBDriver); db == nil || (!strings.HasPrefix(drv, "pgx") && !strings.HasPrefix(drv, "postgres")) {
		log.Warn("accounts: needs Postgres (DB_DRIVER=pgx) — verification, 2FA, SSO and admin routes not mounted")
		return nil
	}
	if err := schema.Migrate(ctx, db); err != nil {
		log.Error("accounts: schema not applied — run `go run ./cmd/migrate`", "err", err)
	}
	for _, email := range schema.AdminEmails() {
		if found, err := schema.Promote(ctx, db, email, "admin"); err != nil {
			log.Warn("accounts: ADMIN_EMAILS promotion failed", "err", err)
		} else if found {
			log.Info("accounts: ADMIN_EMAILS account has the admin role", "email_sha256", emailHash(email)[:12])
		}
	}

	s := &Service{DB: db, Log: log, Auth: svc, Now: time.Now}
	s.Send = NewSender(k, log)
	// The brain plugin resolves session users (and their brain membership)
	// through this; without it signed-in users would have no brain access.
	k.Set(BrainDirectoryKey, NewBrainDirectory(s))

	// Providers first, so the methods rewrite knows what is configured.
	var methods []auth.LoginMethod
	for _, m := range []*auth.LoginMethod{s.mountGoogle(k.Router), s.mountApple(k.Router), s.mountGitHub(k.Router)} {
		if m != nil {
			methods = append(methods, *m)
		}
	}
	names := []string{}
	for _, m := range methods {
		names = append(names, m.Name)
	}
	log.Info("accounts: sign-in providers", "enabled", strings.Join(names, ","))

	// Outermost first: strip revoked credentials before anything reads them.
	k.UseMiddleware(
		s.RevokedSessions,
		s.MethodsMiddleware(func() []auth.LoginMethod { return methods }),
		s.RequireSession,
		s.SignupMiddleware,
	)

	post := func(p string, h http.HandlerFunc) { k.Router.Post(p, h) }
	get := func(p string, h http.HandlerFunc) { k.Router.Get(p, h) }
	s.RegisterSignup(post)
	s.RegisterTwoFactor(post, get)
	s.RegisterIdentities(k.Router)
	RegisterAreaAPI(api, s)
	RegisterAdminAPI(api, s)

	if k.Hooks != nil {
		k.Hooks.On(auth.EventLogin, 100, s.recordLogin)
	}
	s.StartPurger(ctx, time.Hour)
	s.StartExportSweeper(ctx, time.Hour)
	return s
}

// RegisterOpenAPI describes the Huma-based account and admin operations for the
// OpenAPI export (handlers are never invoked there).
func RegisterOpenAPI(api huma.API) {
	RegisterAreaAPI(api, nil)
	RegisterAdminAPI(api, nil)
}
