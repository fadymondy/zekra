package brain

import (
	"embed"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"
)

/*
Push and notification-center text in the 18 languages Zekra ships (web/lib/intl/locales.ts;
docs/i18n.md). English and Arabic stay inline in Go, as they always were; every other language
reads locales/<locale>.json (machine-assisted; lang/glossary.md), falling back to English per
key. A notification stores every language's text (brain_notifications.texts), so a reader who
switches language later still gets theirs. locales/en.json mirrors enPush (a test keeps them
equal).

The locale table is shared with internal/account/i18n.go (the harness module):
scripts/i18n/check.mjs keeps both in step with LOCALES.
*/

// Locales are the languages Zekra ships, in the clients' order.
var Locales = []string{"en", "ar", "es", "fr", "de", "pt-BR", "it", "ru", "tr", "zh-Hans", "ja", "ko", "hi", "id", "nl", "pl", "vi", "uk"}

//go:embed locales/*.json
var localeFS embed.FS

var (
	catalogOnce sync.Once
	catalogs    map[string]map[string]string
)

func loadCatalogs() {
	catalogs = map[string]map[string]string{}
	for _, l := range Locales {
		b, err := localeFS.ReadFile("locales/" + l + ".json")
		if err != nil {
			continue
		}
		m := map[string]string{}
		if json.Unmarshal(b, &m) == nil {
			delete(m, "//")
			catalogs[l] = m
		}
	}
}

func primaryLang(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	if i := strings.IndexAny(tag, "-_"); i >= 0 {
		tag = tag[:i]
	}
	return tag
}

func canonicalLocale(v string) string {
	want := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(v), "_", "-"))
	for _, l := range Locales {
		if strings.ToLower(l) == want {
			return l
		}
	}
	return ""
}

// matchLocale is the best shipped locale for one BCP-47 tag, or "" (same rules as matchOne
// in web/lib/intl/locales.ts: any zh → zh-Hans, any pt → pt-BR, legacy "in" → id).
func matchLocale(tag string) string {
	if l := canonicalLocale(tag); l != "" {
		return l
	}
	switch lang := primaryLang(tag); lang {
	case "zh":
		return "zh-Hans"
	case "pt":
		return "pt-BR"
	case "in":
		return "id"
	case "iw":
		return ""
	default:
		return canonicalLocale(lang)
	}
}

// localeFromAcceptLanguage picks the best shipped locale from an Accept-Language header.
func localeFromAcceptLanguage(header string) string {
	type pref struct {
		tag string
		q   float64
		i   int
	}
	var prefs []pref
	for i, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		tag := strings.TrimSpace(fields[0])
		q := 1.0
		for _, p := range fields[1:] {
			if p = strings.TrimSpace(p); strings.HasPrefix(p, "q=") {
				if f, err := strconv.ParseFloat(p[2:], 64); err == nil {
					q = f
				} else {
					q = 0
				}
			}
		}
		if tag != "" && tag != "*" && q > 0 {
			prefs = append(prefs, pref{tag, q, i})
		}
	}
	sort.SliceStable(prefs, func(a, b int) bool { return prefs[a].q > prefs[b].q })
	for _, p := range prefs {
		if l := matchLocale(p.tag); l != "" {
			return l
		}
	}
	return ""
}

// enPush is the English the catalogs translate. Placeholders are {name}.
var enPush = map[string]string{
	"push.test.title":                   "Zekra",
	"push.test.body":                    "Notifications are working on this device.",
	"push.brainAccess.title":            "A brain was shared with you",
	"push.brainAccess.body":             "You were given access to {name}.",
	"push.presentationViewed.title":     "Your presentation was opened",
	"push.presentationViewed.body":      "“{title}” was just opened from a share link.",
	"push.presentationDownloaded.title": "Your presentation was downloaded",
	"push.presentationDownloaded.body":  "“{title}” was just downloaded from a share link.",
	"presentation.graphSummary":         "{root} ({type}): {count} connected entities across {roles}.",
}

func fill(s string, vars map[string]string) string {
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{"+k+"}", v)
	}
	return s
}

// trText is key in locale (the catalog, else English), placeholders filled.
func trText(locale, key string, vars map[string]string) string {
	catalogOnce.Do(loadCatalogs)
	s := enPush[key]
	if v, ok := catalogs[locale][key]; ok && strings.TrimSpace(v) != "" {
		s = v
	}
	return fill(s, vars)
}

// pushTexts is one notification in every shipped language: en and ar as given (their copy
// lives with the caller), the rest from the catalogs under key+".title" / key+".body".
func pushTexts(key string, vars map[string]string, en, ar pushText) map[string]pushText {
	out := map[string]pushText{"en": en, "ar": ar}
	for _, l := range Locales {
		if l == "en" || l == "ar" {
			continue
		}
		out[l] = pushText{Title: trText(l, key+".title", vars), Body: trText(l, key+".body", vars)}
	}
	return out
}
