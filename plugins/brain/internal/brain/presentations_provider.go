package brain

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
)

/*
GET /api/presentations/translate/provider — who would translate a presentation,
so an app can name it before it sends anything (App Review 5.1.2(i): disclose
and ask before personal data goes to a third-party AI). It mirrors
envTranslator's resolution and never returns a URL or a key:

	{"available": true, "provider": "anthropic", "name": "Anthropic (Claude)", "third_party": true}
	{"available": true, "provider": "self-hosted", "name": "", "third_party": false}
	{"available": true, "provider": "openai-compatible", "name": "api.example.com", "third_party": true}
	{"available": false, "provider": "none", "name": "", "third_party": false}

An OpenAI-compatible endpoint on a private, loopback or single-label host is the
operator's own model ("self-hosted"); any other host is a third party, named by
its host.
*/

// TranslateProvider describes the translator for a disclosure screen.
type TranslateProvider struct {
	Available  bool   `json:"available"`
	Provider   string `json:"provider"`
	Name       string `json:"name"`
	ThirdParty bool   `json:"third_party"`
}

func translateProvider() TranslateProvider {
	if strings.TrimSpace(os.Getenv("PRESENTATIONS_TRANSLATE")) == "0" {
		return TranslateProvider{Provider: "none"}
	}
	if firstEnv("PRESENTATIONS_TRANSLATE_ANTHROPIC_KEY", "BRAIN_CHAT_ANTHROPIC_KEY", "ANTHROPIC_API_KEY") != "" {
		return TranslateProvider{Available: true, Provider: "anthropic", Name: "Anthropic (Claude)", ThirdParty: true}
	}
	endpoint := firstEnv("PRESENTATIONS_TRANSLATE_LLM_URL")
	if endpoint == "" {
		u, _, _, ok := chatLLM()
		if !ok {
			return TranslateProvider{Provider: "none"}
		}
		endpoint = u
	}
	host := endpointHost(endpoint)
	if host == "" || privateHost(host) {
		return TranslateProvider{Available: true, Provider: "self-hosted"}
	}
	return TranslateProvider{Available: true, Provider: "openai-compatible", Name: host, ThirdParty: true}
}

func endpointHost(endpoint string) string {
	u, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// privateHost reports whether host is loopback, private, link-local, a
// single-label name (a container or LAN name) or under .local / .internal.
func privateHost(host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()
	}
	if host == "localhost" || !strings.Contains(host, ".") {
		return true
	}
	for _, suffix := range []string{".local", ".internal", ".lan", ".localhost"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

// PresentationTranslateProvider — GET /api/presentations/translate/provider.
func (s *Service) PresentationTranslateProvider(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, translateProvider())
}
