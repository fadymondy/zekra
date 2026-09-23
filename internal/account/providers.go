package account

import (
	"net/http"
)

/*
GET /api/auth/providers — which of Google / Apple / GitHub this deployment can
sign in with, per surface:

	{"providers": [{"name": "google", "web": true, "app": true, "native": true}, …]}

"web" means the browser flow is mounted (/api/auth/methods lists it).

"app" means the mobile app can run the server's browser flow in an auth session
(ASWebAuthenticationSession / Custom Tabs) and trade the one-time code it gets
back (?app=1&return=zekra://…, then POST /api/auth/<name>/exchange). It needs no
native SDK or per-platform OAuth client:
  - google: the web client is configured (id + secret);
  - github: the OAuth app is configured;
  - apple:  never — Apple's web flow is a form_post, the app uses the sheet.

"native" means the provider's own native sheet works:
  - google: an ID-token audience is configured (the web client id, plus any
    OAUTH_GOOGLE_AUDIENCES) — POST /api/auth/google/token. The app still needs
    its own Google SDK configuration (iOS client id) to use it;
  - apple:  APPLE_BUNDLE_IDS is set, the audience of a token from the iOS
    sheet — POST /api/auth/apple/token (the Services ID alone is the web's);
  - github: there is no native sheet, but it stays true when the app flow is
    on, for app builds that predate "app" and read "native" for GitHub.

Only configured providers are listed. Nothing here is secret. A server that
predates this endpoint answers 404: it has GitHub's app flow (when /methods
lists github) and nothing else the app can use.
*/

type providerStatus struct {
	Name   string `json:"name"`
	Web    bool   `json:"web"`
	App    bool   `json:"app"`
	Native bool   `json:"native"`
}

// configuredProviders reads the same configuration the mount functions do.
func configuredProviders() []providerStatus {
	out := []providerStatus{}
	add := func(p providerStatus) {
		if p.Web || p.App || p.Native {
			out = append(out, p)
		}
	}
	g := loadGoogleConfig()
	add(providerStatus{Name: "google", Web: g.webReady(), App: g.webReady(), Native: len(g.audiences) > 0})
	a, err := loadAppleConfig()
	add(providerStatus{Name: "apple", Web: err == nil && a.webReady(), Native: len(a.bundleIDs) > 0})
	gh := loadGitHubConfig()
	add(providerStatus{Name: "github", Web: gh.ready(), App: gh.ready(), Native: gh.ready()})
	return out
}

func providersHandler(list []providerStatus) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=300")
		writeJSON(w, http.StatusOK, map[string]any{"providers": list})
	}
}
