package account

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func TestMatchLocale(t *testing.T) {
	for in, want := range map[string]string{
		"en": "en", "AR": "ar", "ar-EG": "ar", "de-AT": "de", "pt": "pt-BR", "pt_PT": "pt-BR",
		"zh-CN": "zh-Hans", "zh-TW": "zh-Hans", "zh-hans": "zh-Hans", "in": "id", "ja-JP": "ja",
		"sv": "", "": "", "iw": "",
	} {
		if got := matchLocale(in); got != want {
			t.Errorf("matchLocale(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLocaleFromAcceptLanguage(t *testing.T) {
	for in, want := range map[string]string{
		"de-DE,de;q=0.9,en;q=0.8": "de",
		"sv-SE,fr;q=0.5,ar;q=0.7": "ar",
		"ar":                      "ar",
		"*":                       "",
		"sv":                      "",
		"en;q=0, ja;q=0.1":        "ja",
		"zh-Hant-TW,zh;q=0.9":     "zh-Hans",
		"fr-CA;q=bogus, ko;q=0.2": "ko",
	} {
		if got := localeFromAcceptLanguage(in); got != want {
			t.Errorf("localeFromAcceptLanguage(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResolveLocale(t *testing.T) {
	if got := resolveLocale("ja", "de", "fr"); got != "ja" {
		t.Errorf("body first: %q", got)
	}
	if got := resolveLocale("", "de", "fr"); got != "de" {
		t.Errorf("profile second: %q", got)
	}
	if got := resolveLocale("", "", "fr-FR"); got != "fr" {
		t.Errorf("Accept-Language third: %q", got)
	}
	if got := resolveLocale("xx", "", "sv"); got != "en" {
		t.Errorf("English last: %q", got)
	}
}

// locales/en.json is what translators work from; it must say exactly what the code says.
func TestEnglishCatalogMatchesCode(t *testing.T) {
	b, err := localeFS.ReadFile("locales/en.json")
	if err != nil {
		t.Fatal(err)
	}
	var en map[string]string
	if err := json.Unmarshal(b, &en); err != nil {
		t.Fatal(err)
	}
	delete(en, "//")
	if len(en) != len(enText) {
		t.Errorf("en.json has %d keys, enText %d", len(en), len(enText))
	}
	for k, v := range enText {
		if en[k] != v {
			t.Errorf("en.json[%q] = %q, code says %q", k, en[k], v)
		}
	}
}

var placeholder = regexp.MustCompile(`\{(\w+)\}`)

func names(s string) string {
	var out []string
	for _, m := range placeholder.FindAllStringSubmatch(s, -1) {
		out = append(out, m[1])
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

// Every translated string keeps the English placeholders, and no catalog invents keys.
func TestCatalogPlaceholders(t *testing.T) {
	catalogOnce.Do(loadCatalogs)
	for l, cat := range catalogs {
		for k, v := range cat {
			en, ok := enText[k]
			if !ok {
				t.Errorf("%s: unknown key %q", l, k)
				continue
			}
			if names(v) != names(en) {
				t.Errorf("%s %s: placeholders {%s}, English has {%s}", l, k, names(v), names(en))
			}
		}
	}
}

func TestCodeEmailLanguages(t *testing.T) {
	// English and Arabic keep their copy.
	subj, _, body := CodeEmail("en", purposeVerify, "123456")
	if subj != "123456 is your Zekra verification code" || !strings.Contains(body, `dir="ltr" lang="en"`) {
		t.Errorf("en: %q", subj)
	}
	subj, _, body = CodeEmail("ar", purposeDelete, "123456")
	if !strings.HasPrefix(subj, "123456 هو رمز تأكيد حذف") || !strings.Contains(body, `<html dir="rtl" lang="ar">`) {
		t.Errorf("ar: %q", subj)
	}
	// Any other language: its catalog (or English), LTR, the code still leads the subject.
	for _, l := range Locales[2:] {
		for _, p := range []string{purposeVerify, purposeLogin, purposeReset, purposeDelete, purposeUndelete} {
			subj, text, body := CodeEmail(l, p, "654321")
			if !strings.Contains(subj, "654321") || strings.Contains(subj, "{code}") || strings.Contains(subj, "%!") {
				t.Errorf("%s %s subject: %q", l, p, subj)
			}
			if !strings.Contains(text, "6 5 4 3 2 1") || !strings.Contains(body, `<html dir="ltr" lang="`+l+`">`) {
				t.Errorf("%s %s body", l, p)
			}
		}
		subj, text, _ := ExportEmail(l, "https://app.zekra.dev/x", 48)
		if subj == "" || !strings.Contains(text, "48") || strings.Contains(text, "{hours}") {
			t.Errorf("%s export: %q", l, text)
		}
	}
}
