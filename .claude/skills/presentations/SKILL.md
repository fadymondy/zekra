---
name: presentations
description: Turn what a Zekra brain knows (notes, a recall query, a graph entity, or the whole brain) or any brief into a customer-ready presentation in Zekra (ذكرة) — a slide deck, a report (PDF/Word) and a landing page, in Arabic and English, with workflow diagrams, product screen mockups (phone/tablet/desktop/browser), live maps, icons and motion — then share it by private link. Use when asked to "make a presentation", "present this", "build a pitch/proposal/deck/report/landing page", or "turn this brain/note into a presentation".
---

# Build a presentation in Zekra

Presentations are part of **Zekra** (Arabic name **ذكرة**) and belong to **one brain** (namespace). You turn a source into up to three documents in that brain:

| Kind | What it is | Customer gets |
|---|---|---|
| `deck` | Slides, full-screen viewer, transitions, speaker notes (owner-only) | Link + PDF |
| `report` | Long-form document with sections | Link + PDF + Word |
| `page` | Concept landing page with a style preset | Link |

Everything is **private** and a **draft** until approved and shared. A share link is per document and per language, can expire and can be revoked. Share links look like `https://app.zekra.dev/{locale}/p/{token}` (`en` or `ar`).

The owner works on them in the console at `https://app.zekra.dev/{locale}/b/{namespace}/presentations` (list, "From brain", "New") and `…/presentations/{id}` (editor, live preview, shares, exports).

## 0. Tools you need

The **zekra** MCP server (see `.mcp.json`), acting as an agent with write access to the target brain. Every call is scoped by `namespace`; pick the brain first (`brain_list`, `brain_details`). If a presentation tool is missing from `tools/list` or answers 403, say so; the brain's owner grants access in the brain's **Permissions** page.

| Tool / endpoint | Use |
|---|---|
| `memory_recall` / `memory_get` / notes | Read the source material from the brain (R1–R3 in `.claude/rules/memory-first.md`: recall first, cite what you used, never invent) |
| `graph_neighbors` / `graph_traverse` / `graph_spine` | Find the entity and its connections when the source is a graph node |
| **from-brain** outline source (`POST /api/presentations/from-brain`) | Fast path: drafts a deck, report or page straight from the brain. Body: `{namespace, source, kinds?, locale?, customer?: {name, company, email}, title?, style?}` where `source` is one of `{kind: "notes", ids: [...]}` (1–50 note ids), `{kind: "query", q, limit?}`, `{kind: "entity", id}`, `{kind: "namespace"}` (the whole brain). Returns `{documents: [{id, kind, title, status: "draft"}], sources}`; every sentence comes from the listed sources. The MCP `presentation_create_from_outline` accepts the same `source` |
| `page_styles` / `GET /api/presentations/catalog` | **Call first.** Style presets, every block and part type with fields and limits, the allowed **icon names** (use only these), scene types |
| `presentation_templates` | Complete valid starting skeletons (proposal, pitch, status, assessment, landing) in en/ar |
| `presentation_create_from_outline` | Builds deck + report + page from a plain outline (title, problem, goals, workflow steps, screens, phases, pricing, next step), embeds the page in the deck |
| `presentation_validate` / `POST /api/presentations/validate` | Check content **without saving**; returns every error with `path`. Loop until valid |
| `presentation_create` / `presentation_update` | Save a document (with `namespace`) / replace one locale's content |
| `presentation_translate` | `{id, to}` uses the server model (may be offline); `{id, to, content}` stores a translation **you** wrote. Prefer this |
| `presentation_share` / `presentation_unshare` | Private link (`expires_in_days`, `domain` = a verified custom domain, by host or id), revoke |
| `presentation_domains` / `presentation_domain_add` / `presentation_domain_verify` | The brain's own share domains: list, link a host (returns the TXT + CNAME to publish), check DNS (`default: true` also makes it the default). Brain owner/admin only |
| `presentation_get` / `presentation_list` / `presentation_export` | Read back, list (`namespace`), download links |

Exact MCP tool names can differ by server version: check `tools/list`. The REST paths above are the contract (`/api/presentations*`, list with `?namespace=`).

## 1. Understand the source

- Recall it all from the brain (several keyword queries, R6), and read every note it points to. Keep the **facts exactly**: names, prices, currencies, durations, counts, conditions, what is out of scope. Note which memories you used; they become the citations.
- Identify **who it is for** (customer name + company), the **language** (Arabic source → `ar` primary), **the one message**, and what the audience must decide.
- If the brain has no memory of something the story needs, say so ("the brain has no memory of X"). Don't fill the gap. Log it as a knowledge gap (`memory_gaps`) if useful.
- Never invent results. Mockup numbers are allowed only when labelled **illustrative** ("Illustrative data" / "بيانات توضيحية").

## 2. Plan the story (start → end)

Default arc. Adapt it; don't pad:

1. **Title**: the promise in one line (icon + eyebrow).
2. **Context / numbers**: a `metric` slide.
3. **How it works today / the whole flow**: a `workflow`.
4. **The solution, shown**: `screen` mockups of the real screens (one idea per slide, with `caption` and 1–2 `annotations`).
5. **Special mechanics**: more workflows (decisions, human review, money flow).
6. **Rules and roles**: `two_column`, and a `quote` for a key rule.
7. **Architecture / stack**: a `workflow` of components.
8. **Plan and price**: `bullets` with icons, `metric` for fees.
9. **Branding** (new products): name, mark, palette hex codes, type, app names.
10. **Embed the landing page**: `{type:"embed", document_id}` (a page in the **same brain**).
11. **Next step**: a closing `title`.

The **page** tells the same story top-down: `hero` (with a `visual` screen or workflow) → `features` → workflows and screens → `pricing` → `cta`. The **report** keeps the full text in sections and adds the same diagrams/screens where they belong, plus a sources section citing the brain notes used.

## 3. Choose the right block

| Need | Block | Tips |
|---|---|---|
| A process, lifecycle, approval loop | `workflow` | 4–8 steps; `kind`: `step`, `system`, `human_review`, `decision`, `output`; `owner` per step; `edges` with labels for branches/loops; `highlight` the key step |
| "What the product looks like" | `screen` | Frame by device: **`app`** = phone, **`tablet`** = landscape tablet, **`desktop`** = desktop window, **`browser`** = web app. `layout: sidebar/topbar/none` + `nav` with icons; ≤ 4–5 parts; `focus` a part when it is the point |
| Screen parts | `kpis`, `table` (rows with `status`+`tone`), `form` (fields with `state` ok/missing/warning + `hint`), `chart`, `list`, `timeline`, `board`, `split` (before/after), `callout`, `image`, **`map`** | Always add a `callout` "illustrative data" / "بيانات توضيحية" when numbers are invented |
| Live tracking, dispatch, delivery, locations | `map` part | `markers` (x,y 0–100; `kind` driver/vendor/customer/hub; driver `status` available/busy/offline), `routes` (from/to ids, `via`, `dashed`, `label`), `suggest` {vendor, driver, eta, distance}, `zones`, `legend`. Use `height: "sm"` inside desktop/browser slides so nothing scrolls |
| Before vs after | `two_column` or a `split` part |
| Key numbers / fees | `metric` (≤ 6, each with an icon) |
| A rule people must remember | `quote` |
| Interactive 3D/canvas | Only when it **explains** something, never as decoration. A `code` scene always runs sandboxed (`allow-scripts` only, strict CSP, size cap); don't try to loosen it |

**Icons:** only names from the catalog's `icons` (kebab-case lucide). If one is refused, validation suggests alternatives: pick from the list, never guess.

**Arabic:** write natural Modern Standard (or Egyptian, if the source is) Arabic. Arabic digits are fine in text. The renderer handles RTL: workflows run right-to-left, **maps never mirror**. The product's Arabic name is **ذكرة**.

## 4. Build, validate, save

Write the content as a small Node script (e.g. `<tmp>/<project>/build.cjs`) with a `t(en, ar)` helper so both languages share one structure, and a runner that calls the Zekra MCP/API (credentials from `.mcp.json` or the environment, never printed). Order:

1. Validate every kind × locale. Fix every error first.
2. Create the **page** first (the deck embeds its id), then the report, then the deck, in the primary locale, all with the same `namespace`.
3. Store the other language with `presentation_translate {id, to, content}`. **Both languages, always.**
4. Keep the ids in a file. Later edits use `presentation_update {id, locale, content}` so **links stay the same**; don't re-share on every update.
5. `retain` a short note in the brain: which documents were made, for whom, from which notes (R4).

Customer object: `{name, company, email?}`, with a real person's name when known. Status stays **`draft` until the owner approves**; only then set `ready`.

## 5. Share

- `presentation_share {id, locale, label: "Owner review", expires_in_days: 30}` per kind × language → `https://app.zekra.dev/{locale}/p/{token}`.
- These first links are **for the owner's review**. Create fresh customer links only once they approve; never send anything to a customer yourself.

## 6. Verify in a real browser (required)

Open the share links **signed out** (isolated browser context, foreground tab). They must load with no sign-in, no console chrome and no feedback widget. Reload after edits (a `#slide` change alone doesn't reload). Check in **light and dark**:

- Deck: the title slide, one workflow, one screen per frame type, the map slide, the embed slide. Text inside mockups must be readable (**≥ 13px on a 1440 viewport**); **nothing clipped**; no scrolling inside a slide.
- Page: hero (visual beside the heading, not a tall empty block), one workflow, one screen.
- Downloads: PDF (deck, report) and Word (report) return 200 from `/{locale}/p/{token}/download/{pdf|docx}`.
- Arabic and English.

Fix content problems yourself (shorter lists, `height: "sm"`, fewer parts, a compact hero screen). Renderer bugs: fix them in `plugins/brain/presentations` (Go) or `web/components/presentations` / `web/lib/presentations` (run `node --test lib/presentations/presentations.test.ts` in `web/`).

## 7. Report back

Give the owner a table of the six links (deck/report/page × ar/en), what each contains in a few lines, which brain notes it came from, what you checked and what you didn't, and any known flaw.

## Non-negotiables

- Both languages (English + Arabic) for every document.
- No invented facts or promised savings; label illustrative data ("بيانات توضيحية").
- Draft until approved; no customer-facing links or messages without the owner's approval.
- Mockup text ≥ 13px at 1440 and nothing clipped, in light and dark.
- Code scenes stay sandboxed (CSP, size cap).
- No decorative 3D. No icons outside the list. No secrets in content, scripts or output.
