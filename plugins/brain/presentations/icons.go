package presentations

import (
	"fmt"
	"sort"
	"strings"
)

/*
Icons (FM-341 polish): content names a lucide icon by kebab-case name, from the
curated set in icon_names.go (generated; the web renderer maps exactly the
same names). An unknown name is refused with suggestions, instead of the page
silently showing a dot.
*/

var iconSet = func() map[string]bool {
	m := make(map[string]bool, len(IconNames))
	for _, n := range IconNames {
		m[n] = true
	}
	return m
}()

// IsIcon reports whether name is an accepted icon.
func IsIcon(name string) bool { return iconSet[name] }

// iconSuggestions returns up to five accepted names close to name.
func iconSuggestions(name string) []string {
	n := strings.ToLower(strings.TrimSpace(name))
	n = strings.NewReplacer("_", "-", " ", "-").Replace(n)
	type scored struct {
		name  string
		score int
	}
	var out []scored
	parts := strings.Split(n, "-")
	for _, c := range IconNames {
		s := 0
		if strings.Contains(c, n) || (len(c) > 2 && strings.Contains(n, c)) {
			s += 3
		}
		for _, p := range parts {
			if len(p) > 2 && strings.Contains(c, p) {
				s++
			}
		}
		if d := editDistance(n, c); d <= 2 {
			s += 5 - d
		}
		if s > 0 {
			out = append(out, scored{c, s})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].score != out[j].score {
			return out[i].score > out[j].score
		}
		return len(out[i].name) < len(out[j].name)
	})
	names := []string{}
	for i := 0; i < len(out) && i < 5; i++ {
		names = append(names, out[i].name)
	}
	return names
}

func iconError(name string) string {
	msg := fmt.Sprintf("unknown icon %q; use a kebab-case lucide name from page_styles.icons (%d names)", name, len(IconNames))
	if s := iconSuggestions(name); len(s) > 0 {
		msg += ", e.g. " + strings.Join(s, ", ")
	}
	return msg
}

func editDistance(a, b string) int {
	if a == b {
		return 0
	}
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(b)]
}
