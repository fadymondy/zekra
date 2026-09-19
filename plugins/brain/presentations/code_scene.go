package presentations

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

/*
The "code" scene (FM-346): HTML/CSS/JS a model writes, for the animations the
vetted scene types cannot draw.

The real guard is where it runs: web/components/presentations/scenes/
code-scene.tsx renders it ONLY as <iframe sandbox="allow-scripts" srcdoc=...>
(an opaque origin: no cookies, storage, parent DOM, forms, popups, modals or
top navigation) with CodeSceneCSP as a <meta> CSP inside the document (no
network, no nested frames, scripts only inline or from the allowlist below).

This validation is defence in depth: it refuses the markup that could escape or
weaken that frame if the frame were ever misconfigured, and pins external
scripts so a stored scene cannot change behind our back.
*/

// CodeSceneCSP is the policy the web app puts in the frame's <meta>. The web
// copy (web/lib/presentations/code-scene.ts) is tested against this string.
//
// script-src names the pinned three.js DIRECTORIES, not whole hosts, so a
// script injected at runtime (which validation cannot see) still cannot load
// anything else from jsdelivr or unpkg.
const CodeSceneCSP = "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net/npm/three@0.180.0/ https://unpkg.com/three@0.180.0/; " +
	"style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; " +
	"frame-src 'none'; form-action 'none'"

// CodeSceneMaxBytes caps the html param.
const CodeSceneMaxBytes = 200 * 1024

const codeSceneMaxKB = "200 KB"

// CodeSceneAspects are the frame shapes a code scene may ask for.
var CodeSceneAspects = []string{"16:9", "4:3", "1:1", "21:9", "3:1"}

// ThreeVersion is the one three.js release code scenes may load (the web app's).
const ThreeVersion = "0.180.0"

// CodeScriptAllowlist is every external script URL a code scene may load:
// exact files, plus the three.js addons directory (entries ending in "/").
var CodeScriptAllowlist = []string{
	"https://cdn.jsdelivr.net/npm/three@" + ThreeVersion + "/build/three.module.js",
	"https://cdn.jsdelivr.net/npm/three@" + ThreeVersion + "/build/three.module.min.js",
	"https://cdn.jsdelivr.net/npm/three@" + ThreeVersion + "/examples/jsm/",
	"https://unpkg.com/three@" + ThreeVersion + "/build/three.module.js",
	"https://unpkg.com/three@" + ThreeVersion + "/build/three.module.min.js",
	"https://unpkg.com/three@" + ThreeVersion + "/examples/jsm/",
}

func codeScriptAllowlistText() string {
	return strings.Join(CodeScriptAllowlist, ", ") + " (an entry ending in / allows the .js files under it)"
}

// AllowedScriptURL reports whether u is on CodeScriptAllowlist.
func AllowedScriptURL(u string) bool {
	if strings.ContainsAny(u, "?#\\% \t\r\n") || strings.Contains(u, "..") {
		return false
	}
	for _, a := range CodeScriptAllowlist {
		if strings.HasSuffix(a, "/") {
			if strings.HasPrefix(u, a) && strings.HasSuffix(u, ".js") && len(u) > len(a)+3 {
				return true
			}
		} else if u == a {
			return true
		}
	}
	return false
}

func allowedScriptDir(u string) bool {
	for _, a := range CodeScriptAllowlist {
		if strings.HasSuffix(a, "/") && u == a {
			return true
		}
	}
	return false
}

// Tags a code scene may never contain.
var codeForbiddenTags = map[string]string{
	"base":        "<base> is not allowed (it would re-point every relative URL)",
	"iframe":      "<iframe> is not allowed (no nested frames)",
	"frame":       "<frame> is not allowed (no nested frames)",
	"frameset":    "<frameset> is not allowed (no nested frames)",
	"portal":      "<portal> is not allowed (no nested frames)",
	"fencedframe": "<fencedframe> is not allowed (no nested frames)",
	"object":      "<object> is not allowed",
	"embed":       "<embed> is not allowed",
	"applet":      "<applet> is not allowed",
	"link":        "<link> is not allowed (put CSS in a <style> element; external stylesheets are blocked)",
}

// Module imports with a literal specifier: import x from "…", import "…",
// import("…"), export … from "…".
var importRe = regexp.MustCompile("(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*)[\"'`]([^\"'`]+)[\"'`]")

// validateCodeHTML returns every problem with a code scene's html.
func validateCodeHTML(src string) []string {
	if len(src) > CodeSceneMaxBytes {
		return []string{fmt.Sprintf("is %d bytes; a code scene allows at most %d (%s)", len(src), CodeSceneMaxBytes, codeSceneMaxKB)}
	}
	if strings.TrimSpace(src) == "" {
		return []string{"must not be empty"}
	}
	if strings.ContainsRune(src, 0) {
		return []string{"must not contain NUL bytes"}
	}
	var errs []string
	seen := map[string]bool{}
	add := func(msg string) {
		if !seen[msg] {
			seen[msg] = true
			errs = append(errs, msg)
		}
	}
	// Relative specifiers resolve against about:srcdoc and fail; bare ones need
	// an importmap, whose targets are checked. Only URLs that could load
	// something are judged.
	checkURL := func(where, u string) {
		u = strings.TrimSpace(u)
		if strings.Contains(u, ":") || strings.HasPrefix(u, "//") {
			if !AllowedScriptURL(u) {
				add(fmt.Sprintf("%s %q is not on the script allowlist: %s", where, u, codeScriptAllowlistText()))
			}
		}
	}

	z := html.NewTokenizer(strings.NewReader(src))
	inScript, scriptType := false, ""
	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			if err := z.Err(); err != nil && !errors.Is(err, io.EOF) {
				add("could not be parsed: " + err.Error())
			}
			return errs
		case html.StartTagToken, html.SelfClosingTagToken:
			tok := z.Token()
			name := strings.ToLower(tok.Data)
			if msg, bad := codeForbiddenTags[name]; bad {
				add(msg)
				continue
			}
			attrs := map[string]string{}
			for _, a := range tok.Attr {
				k := strings.ToLower(a.Key)
				if a.Namespace != "" {
					k = strings.ToLower(a.Namespace) + ":" + k
				}
				attrs[k] = a.Val
			}
			switch name {
			case "meta":
				if eq, ok := attrs["http-equiv"]; ok {
					if strings.EqualFold(strings.TrimSpace(eq), "refresh") {
						add(`<meta http-equiv="refresh"> is not allowed (no navigation)`)
					} else {
						add("<meta http-equiv> is not allowed (the frame's policy is fixed)")
					}
				}
			case "script":
				for _, k := range []string{"src", "href", "xlink:href"} {
					u, ok := attrs[k]
					if !ok {
						continue
					}
					if !AllowedScriptURL(strings.TrimSpace(u)) {
						add(fmt.Sprintf("<script %s=%q> is not on the script allowlist: %s", k, u, codeScriptAllowlistText()))
					}
				}
				if tt == html.StartTagToken {
					inScript, scriptType = true, strings.ToLower(strings.TrimSpace(attrs["type"]))
				}
			}
		case html.EndTagToken:
			if tok := z.Token(); strings.EqualFold(tok.Data, "script") {
				inScript = false
			}
		case html.TextToken:
			if !inScript {
				continue
			}
			body := string(z.Text())
			if scriptType == "importmap" {
				var m struct {
					Imports map[string]string            `json:"imports"`
					Scopes  map[string]map[string]string `json:"scopes"`
				}
				if err := json.Unmarshal([]byte(body), &m); err != nil {
					add(`<script type="importmap"> must be valid JSON`)
					continue
				}
				check := func(k, u string) {
					// A prefix mapping ("three/addons/") may point at an allowlisted directory.
					if strings.HasSuffix(k, "/") && allowedScriptDir(strings.TrimSpace(u)) {
						return
					}
					checkURL("importmap target", u)
				}
				for k, u := range m.Imports {
					check(k, u)
				}
				for _, sc := range m.Scopes {
					for k, u := range sc {
						check(k, u)
					}
				}
				continue
			}
			for _, mm := range importRe.FindAllStringSubmatch(body, -1) {
				checkURL("import", mm[1])
			}
		}
	}
}
