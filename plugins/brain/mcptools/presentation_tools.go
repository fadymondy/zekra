package mcptools

import (
	"encoding/json"
	"net/url"
	"strings"

	"github.com/togo-framework/brain/presentations"
)

/*
Presentation tools (ported from fadymondy.com FM-345/350): decks, reports and
page previews in a brain, authored over MCP, shared by private link. Every tool
is a thin call to /api/presentations* (internal/brain/presentations_handlers.go),
where the brain's ACL applies: reads need read access to the document's brain,
everything that writes, translates or issues a link needs write access (a
brain owner/editor, a write grant, or OAuth brains:write). Input schemas are
plain objects (no oneOf/anyOf) so OpenAI and Gemini tool calling accept them.
*/

func presentationToolDefs() []map[string]any {
	str := prop{"type": "string"}
	strList := prop{"type": "array", "items": str}
	kinds := prop{"type": "string", "enum": presentations.Kinds}
	locale := prop{"type": "string", "enum": presentations.Locales}
	status := prop{"type": "string", "enum": presentations.Statuses}
	styles := make([]string, 0, len(presentations.StylePresets))
	for _, s := range presentations.StylePresets {
		styles = append(styles, s.Key)
	}
	style := prop{"type": "string", "enum": styles, "description": "page previews only; default minimal"}
	customer := prop{"type": "object", "description": "who it is for: a name or a company is required",
		"properties": prop{"name": str, "company": str,
			"email": prop{"type": "string", "description": "optional; never shown on a share link"}}}
	content := prop{"type": "object", "description": "one locale's content, shaped by kind (see page_styles for the full JSON Schema)"}
	ns := prop{"type": "string", "description": "the brain (namespace) the documents belong to"}
	id := prop{"type": "string", "description": "presentation id"}
	schemaNote := " " + presentations.SchemaSummary()

	return []map[string]any{
		{
			"name": "page_styles",
			"description": "What a presentation may use: page-preview style presets (minimal, bold, editorial, tech-dark), " +
				"scene types (three.js: particles, globe, floating_geometry, product_orbit; canvas: gradient_mesh, " +
				"generative_lines, chart; iframe: code), the ICONS list (the only names an icon field accepts), the workflow and " +
				"screen blocks with an example each, every param's kind, range, enum and default, the colour tokens scenes may " +
				"name (never raw colours), and the full JSON Schema of deck, report and page content. Call this before " +
				"authoring a page preview. Type \"code\" scenes are your own HTML/CSS/JS (html at most 200 KB), run ONLY in " +
				"<iframe sandbox=\"allow-scripts\"> with an opaque origin and this CSP: " + presentations.CodeSceneCSP +
				". No fetch/XHR/WebSocket, storage, forms, popups or nested frames; scripts only from the pinned list (three.js " +
				presentations.ThreeVersion + "): " + strings.Join(presentations.CodeScriptAllowlist, ", ") + ".",
			"inputSchema": obj(prop{"kind": prop{"type": "string", "enum": presentations.Kinds, "description": "only this kind's schema"}}),
		},
		{
			"name": "presentation_list",
			"description": "Decks, reports and page previews in the brains you can read, newest first (up to 100), without content: " +
				"id, namespace, kind, title, customer, locale, locales present, status, style, view/download counts, last viewed, " +
				"active share links. Filters: namespace (one brain), q (title, customer, id), kind, customer, status.",
			"inputSchema": obj(prop{"namespace": prop{"type": "string", "description": "optional; default = every brain you can read"},
				"q": str, "kind": kinds, "customer": str, "status": status}),
		},
		{
			"name": "presentation_get",
			"description": "One document with all its content (every locale, speaker notes included), translation provenance, " +
				"view stats and its share links (url present when it can be copied again). Read-checked on its brain.",
			"inputSchema": obj(prop{"id": id}, "id"),
		},
		{
			"name": "presentation_create",
			"description": "WRITE. Create a deck (slides), report (long-form, PDF/Word) or page preview (a concept landing page " +
				"with a style preset and optional scenes) in a brain, for a customer. Private until shared; status draft by default. " +
				"Args: namespace*, kind*, customer* {name, company, email}, locale (en|ar, default en), content* (that locale), " +
				"title (default: content.title), status (draft|ready|archived), style (pages). Invalid content returns every " +
				"error with its JSON path and a fix hint." + schemaNote,
			"inputSchema": obj(prop{"namespace": ns, "kind": kinds, "customer": customer, "locale": locale, "content": content,
				"title": str, "status": status, "style": style}, "namespace", "kind", "customer", "content"),
		},
		{
			"name": "presentation_update",
			"description": "WRITE. Change a document. Only given fields change. content replaces ONE locale's content (locale, " +
				"default the document's primary locale) and is validated like create; this is also how you store a translation " +
				"you wrote yourself. Without content, locale switches the primary language (content in it must exist). Also: " +
				"title, customer, status (set ready once approved), style (pages). Kind and brain cannot change." + schemaNote,
			"inputSchema": obj(prop{"id": id, "locale": locale, "content": content, "title": str, "customer": customer,
				"status": status, "style": style}, "id"),
		},
		{
			"name": "presentation_translate",
			"description": "WRITE. Fill the other language (to: en|ar, default the one missing). Without content, the server's " +
				"configured model translates it (one call; the structure must come back unchanged). If none is configured it " +
				"answers no_translator with source_content: translate every human-readable string yourself (keep type, URLs, " +
				"ids, code, scene and numbers unchanged) and call again with content = the translated object.",
			"inputSchema": obj(prop{"id": id, "to": locale, "content": content}, "id"),
		},
		{
			"name": "presentation_share",
			"description": "WRITE (brain owner/editor). Create a share link the customer opens without an account: returns url " +
				"({base}/{locale}/p/{token}) and download URLs (deck: pdf; report: pdf, docx). The 256-bit token is stored " +
				"hashed; the view is read-only, noindex, without speaker notes or the customer's email. " +
				"Args: id*, locale (default the document's), label, expires_in_days (0 = never), domain (a VERIFIED custom " +
				"domain of the brain, by host or id, see presentation_domains; default: the brain's default domain, else " +
				"the built-in host). Views are counted.",
			"inputSchema": obj(prop{"id": id, "locale": locale, "label": str,
				"domain":          prop{"type": "string", "description": "host or id of a verified custom share domain"},
				"expires_in_days": prop{"type": "integer", "minimum": 0, "maximum": 3650}}, "id"),
		},
		{
			"name": "presentation_domains",
			"description": "Custom share domains of a brain: the hosts its share links can be served on instead of the built-in " +
				"one. Each has verified, default, the TXT record to publish (verifyRecord) and the CNAME (cname), and lastError " +
				"from the last DNS check. Args: namespace*.",
			"inputSchema": obj(prop{"namespace": str}, "namespace"),
		},
		{
			"name": "presentation_domain_add",
			"description": "WRITE (brain owner/admin). Link a domain or subdomain (deck.example.com: no scheme, path or port) to a " +
				"brain's share links. Returns the two DNS records the domain's owner must publish: TXT verifyRecord.name = " +
				"verifyRecord.value, and CNAME cname.name -> cname.target. Then call presentation_domain_verify. " +
				"Args: namespace*, host*.",
			"inputSchema": obj(prop{"namespace": str, "host": str}, "namespace", "host"),
		},
		{
			"name": "presentation_domain_verify",
			"description": "WRITE (brain owner/admin). Check a linked domain's DNS now (TXT + CNAME). verified = true means share " +
				"links can use it (presentation_share domain); otherwise lastError says which record is wrong. DNS changes can " +
				"take minutes to appear. Args: id* (the domain id), default (true = also make it the brain's default).",
			"inputSchema": obj(prop{"id": str, "default": prop{"type": "boolean"}}, "id"),
		},
		{
			"name": "presentation_unshare",
			"description": "WRITE (brain owner/editor). Revoke share links: share_id revokes one; without it, every link of the " +
				"document. A revoked link answers 'not available' exactly like an unknown one.",
			"inputSchema": obj(prop{"id": id, "share_id": str}, "id"),
		},
		{
			"name": "presentation_export",
			"description": "WRITE. Download URLs for a deck (pdf, one page per slide) or report (pdf, docx; Arabic is right-to-left). " +
				"Returns customer_downloads through an existing copyable share link for the locale, or a new 7-day link " +
				"labelled \"export\", plus owner_downloads (need a console session). The web console renders the files. " +
				"Page previews have no file export: share them instead.",
			"inputSchema": obj(prop{"id": id, "locale": locale}, "id"),
		},
		{
			"name": "presentation_templates",
			"description": "Starter documents to copy and fill: " + strings.Join(presentations.TemplateKeys, ", ") + ". Each has " +
				"complete, VALID content per kind (deck/report/page) in en and ar, with <placeholders> to replace, plus the outline " +
				"that produced it. Args (all optional): template, kind, locale.",
			"inputSchema": obj(prop{"template": prop{"type": "string", "enum": presentations.TemplateKeys}, "kind": kinds, "locale": locale}),
		},
		{
			"name": "presentation_validate",
			"description": "Check content WITHOUT saving. Args: kind* (deck|report|page), content* (one locale's content object). " +
				"Returns valid, and every error as {path, message, hint}. Fix all listed paths and call again until valid:true.",
			"inputSchema": obj(prop{"kind": kinds, "content": content}, "kind", "content"),
		},
		{
			"name": "presentation_create_from_outline",
			"description": "WRITE. The easy path: the server builds valid documents (no model needed), links the page into the deck, " +
				"and returns their ids. Two ways:\n" +
				"1. FROM THE BRAIN (preferred when the brain knows the topic): namespace* + source*, one of " +
				`{"kind":"notes","ids":[…]}, {"kind":"query","q":"…","limit":12}, {"kind":"entity","id":"<entity id or name>"} (its spine), ` +
				`{"kind":"namespace"} (the brain's top notes by category). Only the gathered material is used: no invented facts, ` +
				"no placeholder plan or prices; the report cites its sources; documents stay draft until you set status ready. " +
				"Optional: title, customer (default: the brain), locale, kinds (default deck + report), style.\n" +
				"2. FROM A PASTED OUTLINE: namespace*, customer* {name or company}, title*, problem*, and optional locale, kinds, " +
				"template (" + strings.Join(presentations.TemplateKeys, "|") + "), goals, workflow_steps (strings or {title, owner}), " +
				"screens, phases [{name, duration, deliverables}], pricing [{item, price, note}], next_step, status (draft|ready), style.",
			"inputSchema": obj(prop{
				"namespace": ns,
				"source": prop{"type": "object", "description": "use the brain's material instead of a pasted outline",
					"properties": prop{"kind": prop{"type": "string", "enum": presentations.BrainSourceKinds},
						"ids": strList, "q": str, "limit": prop{"type": "integer"}, "id": str}},
				"customer": prop{"type": "object", "properties": prop{"name": str, "company": str, "email": str}},
				"locale":   locale, "kinds": prop{"type": "array", "items": kinds},
				"template": prop{"type": "string", "enum": presentations.TemplateKeys},
				"title":    str, "problem": str, "goals": strList, "next_step": str,
				"workflow_steps": prop{"type": "array", "description": `each a string or {"title","owner"}`,
					"items": prop{"type": "string", "description": `a step title; an object {"title", "owner"} is also accepted`}},
				"screens": strList,
				"phases": prop{"type": "array", "items": prop{"type": "object", "properties": prop{
					"name": str, "duration": str, "deliverables": strList}}},
				"pricing": prop{"type": "array", "items": prop{"type": "object", "properties": prop{
					"item": str, "price": str, "note": str}}},
				"status": prop{"type": "string", "enum": []string{"draft", "ready"}},
				"style":  str,
			}, "namespace"),
		},
	}
}

func init() {
	graphToolDefs = append(graphToolDefs, presentationToolDefs()...)
	for _, n := range []string{"page_styles", "presentation_list", "presentation_get", "presentation_templates", "presentation_validate"} {
		toolAccess[n] = AccessRead
	}
	toolAccess["presentation_domains"] = AccessRead
	toolAccess["presentation_domain_add"] = AccessWrite
	toolAccess["presentation_domain_verify"] = AccessWrite
	for _, n := range []string{"presentation_create", "presentation_update", "presentation_translate", "presentation_share",
		"presentation_unshare", "presentation_export", "presentation_create_from_outline"} {
		toolAccess[n] = AccessWrite
	}
}

// objectContent turns a content given as a JSON string into an object (some
// clients send nested JSON as a string); anything else is passed through for
// the server to judge.
func objectContent(v any) any {
	if s, ok := v.(string); ok {
		var m map[string]any
		if json.Unmarshal([]byte(s), &m) == nil {
			return m
		}
	}
	return v
}

// callPresentation dispatches the presentation tools; ok=false for any other name.
func callPresentation(name string, args map[string]any, post, patch func(string, map[string]any), get func(string, url.Values), del func(string)) bool {
	doc := func(suffix string) string { return "/api/presentations/" + url.PathEscape(str(args["id"])) + suffix }
	switch name {
	case "page_styles":
		get("/api/presentations/catalog", nonEmpty(url.Values{"kind": {str(args["kind"])}}))
	case "presentation_list":
		get("/api/presentations", nonEmpty(url.Values{"namespace": {str(args["namespace"])}, "q": {str(args["q"])},
			"kind": {str(args["kind"])}, "customer": {str(args["customer"])}, "status": {str(args["status"])}}))
	case "presentation_get":
		get(doc(""), nil)
	case "presentation_create":
		post("/api/presentations", map[string]any{"namespace": args["namespace"], "kind": args["kind"],
			"customer": args["customer"], "locale": args["locale"], "content": objectContent(args["content"]),
			"title": args["title"], "status": args["status"], "style": args["style"]})
	case "presentation_update":
		patch(doc(""), map[string]any{"locale": args["locale"], "content": objectContent(args["content"]),
			"title": args["title"], "customer": args["customer"], "status": args["status"], "style": args["style"]})
	case "presentation_translate":
		post(doc("/translate"), map[string]any{"to": args["to"], "content": objectContent(args["content"])})
	case "presentation_share":
		post(doc("/share"), map[string]any{"locale": args["locale"], "label": args["label"], "expires_in_days": args["expires_in_days"],
			"domain": args["domain"]})
	case "presentation_domains":
		get("/api/presentations/domains", nonEmpty(url.Values{"namespace": {str(args["namespace"])}}))
	case "presentation_domain_add":
		post("/api/presentations/domains", map[string]any{"namespace": args["namespace"], "host": args["host"]})
	case "presentation_domain_verify":
		base := "/api/presentations/domains/" + url.PathEscape(str(args["id"]))
		if def, ok := args["default"].(bool); ok && def {
			post(base+"/verify?default=1", map[string]any{})
		} else {
			post(base+"/verify", map[string]any{})
		}
	case "presentation_unshare":
		if sid := str(args["share_id"]); sid != "" {
			del(doc("/shares/" + url.PathEscape(sid)))
		} else {
			del(doc("/shares"))
		}
	case "presentation_export":
		post(doc("/export"), map[string]any{"locale": args["locale"]})
	case "presentation_templates":
		get("/api/presentations/templates", nonEmpty(url.Values{"template": {str(args["template"])},
			"kind": {str(args["kind"])}, "locale": {str(args["locale"])}}))
	case "presentation_validate":
		post("/api/presentations/validate", map[string]any{"kind": args["kind"], "content": objectContent(args["content"])})
	case "presentation_create_from_outline":
		if src, ok := args["source"]; ok && src != nil {
			post("/api/presentations/from-brain", map[string]any{"namespace": args["namespace"], "source": src,
				"title": args["title"], "customer": args["customer"], "locale": args["locale"], "kinds": args["kinds"],
				"style": args["style"]})
		} else {
			post("/api/presentations/from-outline", args)
		}
	default:
		return false
	}
	return true
}
