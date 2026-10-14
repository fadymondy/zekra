package brain

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestNormalizePushLocale(t *testing.T) {
	for in, want := range map[string]string{
		"ar-EG": "ar", "en_US": "en", "de_AT": "de", "zh-CN": "zh-Hans", "pt-PT": "pt-BR",
		"ja": "ja", "sv-SE": "en", "": "en",
	} {
		if got := normalizePushLocale(in); got != want {
			t.Errorf("normalizePushLocale(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPushEnglishCatalogMatchesCode(t *testing.T) {
	b, err := localeFS.ReadFile("locales/en.json")
	if err != nil {
		t.Fatal(err)
	}
	var en map[string]string
	if err := json.Unmarshal(b, &en); err != nil {
		t.Fatal(err)
	}
	delete(en, "//")
	if len(en) != len(enPush) {
		t.Errorf("en.json has %d keys, enPush %d", len(en), len(enPush))
	}
	for k, v := range enPush {
		if en[k] != v {
			t.Errorf("en.json[%q] = %q, code says %q", k, en[k], v)
		}
	}
}

var pushPlaceholder = regexp.MustCompile(`\{(\w+)\}`)

func pushNames(s string) string {
	var out []string
	for _, m := range pushPlaceholder.FindAllStringSubmatch(s, -1) {
		out = append(out, m[1])
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func TestPushCatalogPlaceholders(t *testing.T) {
	catalogOnce.Do(loadCatalogs)
	for l, cat := range catalogs {
		for k, v := range cat {
			en, ok := enPush[k]
			if !ok {
				t.Errorf("%s: unknown key %q", l, k)
				continue
			}
			if pushNames(v) != pushNames(en) {
				t.Errorf("%s %s: placeholders {%s}, English has {%s}", l, k, pushNames(v), pushNames(en))
			}
		}
	}
}

// Every shipped language gets a filled title and body; en and ar keep the caller's copy.
func TestPushTextsCoverEveryLocale(t *testing.T) {
	msg := brainAccessMessage("acme", "Acme")
	if len(msg.Text) != len(Locales) {
		t.Fatalf("%d languages, want %d", len(msg.Text), len(Locales))
	}
	if msg.Text["en"].Body != "You were given access to Acme." || !strings.Contains(msg.Text["ar"].Body, "Acme") {
		t.Errorf("en/ar changed: %+v", msg.Text)
	}
	for _, l := range Locales {
		tx := msg.textFor(l)
		if tx.Title == "" || !strings.Contains(tx.Body, "Acme") || strings.Contains(tx.Body, "{") {
			t.Errorf("%s: %+v", l, tx)
		}
	}
	if got := msg.textFor("sv"); got != msg.Text["en"] {
		t.Errorf("unknown language should read English, got %+v", got)
	}
}
