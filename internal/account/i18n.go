package account

import (
	"context"
	"embed"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
)

/*
Server-side languages, the same 18 as the clients (web/lib/intl/locales.ts; docs/i18n.md).
English and Arabic copy stays inline in Go, as it always was. Every other language reads
locales/<locale>.json (machine-assisted; lang/glossary.md). A missing key falls back to English,
so a half-translated catalog never breaks a mail. locales/en.json is the source the translators
work from: a test keeps it equal to the English in code (enText).

The same table lives in plugins/brain/internal/brain/i18n.go (a separate module):
scripts/i18n/check.mjs keeps both in step with LOCALES.
*/

// Locales are the languages Zekra ships, in the clients' order.
var Locales = []string{"en", "ar", "es", "fr", "de", "pt-BR", "it", "ru", "tr", "zh-Hans", "ja", "ko", "hi", "id", "nl", "pl", "vi", "uk"}

// rtlLanguages are right-to-left by primary subtag (only ar ships today).
var rtlLanguages = map[string]bool{"ar": true, "fa": true, "ur": true, "he": true, "ps": true, "sd": true, "ug": true, "yi": true, "dv": true, "ckb": true}

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

// normLocale maps any input to a shipped locale, English when nothing matches.
func normLocale(v string) string {
	if l := matchLocale(v); l != "" {
		return l
	}
	return "en"
}

func isRTL(locale string) bool { return rtlLanguages[primaryLang(locale)] }

// tr is the copy for key in locale: the catalog entry, else en (the English in code), with
// {name} placeholders filled from vars. Only called for languages other than English/Arabic.
func tr(locale, key, en string, vars map[string]string) string {
	catalogOnce.Do(loadCatalogs)
	s := en
	if v, ok := catalogs[locale][key]; ok && strings.TrimSpace(v) != "" {
		s = v
	}
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{"+k+"}", v)
	}
	return s
}

// localeOf resolves a request's language: the one the client sent (body), then
// Accept-Language, then English.
func localeOf(r *http.Request, explicit string) string {
	return resolveLocale(explicit, "", r.Header.Get("Accept-Language"))
}

// resolveLocale: an explicit language, then the account's saved one, then Accept-Language,
// then English.
func resolveLocale(explicit, saved, acceptLanguage string) string {
	for _, v := range []string{explicit, saved} {
		if l := matchLocale(v); l != "" {
			return l
		}
	}
	if l := localeFromAcceptLanguage(acceptLanguage); l != "" {
		return l
	}
	return "en"
}

// profileLocale is the language saved on userID's account ("" when none).
func (s *Service) profileLocale(ctx context.Context, userID string) string {
	var l string
	if s == nil || s.DB == nil || userID == "" {
		return ""
	}
	_ = s.DB.QueryRowContext(ctx, `SELECT locale FROM account_profiles WHERE user_id = $1`, userID).Scan(&l)
	return l
}
