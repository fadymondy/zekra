package server

import (
	"context"

	"github.com/togo-framework/brain/hubapi"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/zekra/internal/account"
	"github.com/fadymondy/zekra/internal/app"
	"github.com/fadymondy/zekra/internal/circlexo"
)

// installCircleXO wires the hub integration (docs/circlexo.md). With CIRCLEXO_ISSUER unset it does
// nothing but answer /api/circlexo/config with {"enabled":false}, and the process is exactly the one
// without it. A half-set configuration is logged as an error and leaves the integration off rather
// than stopping the API: Zekra's own sign-in must not depend on the hub being configured correctly.
func installCircleXO(k *togo.Kernel, a *app.App, acct *account.Service) {
	s, err := circlexo.FromEnv(a.SQLDB, k.Log, acct)
	if err == nil && s != nil {
		err = circlexo.Migrate(context.Background(), a.SQLDB)
	}
	if err != nil {
		k.Log.Error("circlexo: not enabled: fix the CIRCLEXO_* configuration", "err", err)
		s = nil
	}
	circlexo.Install(s) // also clears the hooks when off, for a process that boots more than once
	k.Router.Get(circlexo.ConfigPath, circlexo.ConfigHandler)
	if s != nil {
		s.Mount(k.Router)
		k.Set(hubapi.Key, s) // the brain plugin accepts hub tokens and applies plan limits through this
		k.Log.Info("circlexo: hub integration enabled")
	}
}
