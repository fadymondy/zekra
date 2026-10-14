package brain

import "testing"

func TestTranslateProvider(t *testing.T) {
	clear := func() {
		for _, k := range []string{"PRESENTATIONS_TRANSLATE", "PRESENTATIONS_TRANSLATE_ANTHROPIC_KEY", "BRAIN_CHAT_ANTHROPIC_KEY",
			"ANTHROPIC_API_KEY", "PRESENTATIONS_TRANSLATE_LLM_URL", "BRAIN_CHAT_LLM_URL", "EXTRACTION_LLM_URL"} {
			t.Setenv(k, "")
		}
	}
	cases := []struct {
		name, key, value string
		want             TranslateProvider
	}{
		{"nothing", "", "", TranslateProvider{Provider: "none"}},
		{"off", "PRESENTATIONS_TRANSLATE", "0", TranslateProvider{Provider: "none"}},
		{"anthropic", "ANTHROPIC_API_KEY", "k", TranslateProvider{Available: true, Provider: "anthropic", Name: "Anthropic (Claude)", ThirdParty: true}},
		{"tunnel", "BRAIN_CHAT_LLM_URL", "http://192.0.2.1:4581", TranslateProvider{Available: true, Provider: "self-hosted"}},
		{"container", "EXTRACTION_LLM_URL", "http://ollama:11434", TranslateProvider{Available: true, Provider: "self-hosted"}},
		{"loopback", "PRESENTATIONS_TRANSLATE_LLM_URL", "http://127.0.0.1:8000/v1", TranslateProvider{Available: true, Provider: "self-hosted"}},
		{"public", "PRESENTATIONS_TRANSLATE_LLM_URL", "https://API.Example.com/v1", TranslateProvider{Available: true, Provider: "openai-compatible", Name: "api.example.com", ThirdParty: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			clear()
			if c.key != "" {
				t.Setenv(c.key, c.value)
			}
			if got := translateProvider(); got != c.want {
				t.Fatalf("got %+v, want %+v", got, c.want)
			}
		})
	}
}
