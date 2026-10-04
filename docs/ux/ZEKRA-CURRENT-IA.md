# Zekra — current information architecture (audit)

Audited 2026-10-05 against `main` @ `7340037` (after the Nasaq UI swap, `d31e8ef`).
Scope: the authenticated web console (`web/app/[locale]/`), the REST + MCP surface it sits
on (`plugins/brain/internal/brain`, `internal/`), and the data model behind both.
Companion docs: [TARGET-IA](ZEKRA-TARGET-IA.md) · [MIGRATION](ZEKRA-MIGRATION.md) ·
[CAPABILITY-GAPS](ZEKRA-CAPABILITY-GAPS.md).

Verdict legend used in the route table: **KEEP** (stays where it is, may be restyled) ·
**MOVE** (same function, new place) · **MERGE** (folded into another screen) ·
**REDESIGN** (same route, new structure) · **DEPRECATE** (kept working, no longer linked).
No row is DELETE — nothing that works is removed.

---

## 1. Shell and navigation today

Source: `web/lib/nav.ts`, rendered by `web/components/shell/app-shell.tsx` (Nasaq `AppShell`
+ `Sidebar`, collapsible/resizable, sheet below `md`, ⌘/Ctrl+B).

Top bar: sidebar toggle · brain switcher (inside a brain) · Spotlight (⌘K) · Report a problem ·
Live indicator · Notification bell · User menu.

| Sidebar | Items (in order) |
|---|---|
| Brains (`BRAINS_NAV`) | Brains · Connect an agent · All presentations (→ `/admin/presentations`, **admin-gated: non-admins get Forbidden**) · *You:* Account, Security |
| Per brain (`brainNav(ns)`) | Overview · **Notes** · Presentations · Chat · Search · Sources · Sessions · Gaps · Activity · *Settings:* Settings, Secrets, Permissions |
| Account | Brains · Profile · Security · Connected accounts · Connected apps · Notifications · Reading · Export data · Delete account |
| Admin | Overview · Users · All brains · All presentations · Tokens & access · Global search · System activity · *System:* Settings · *You:* Back to brains |

Where Notes dominates: 2nd brain nav item; the Overview's main block is "Recent notes" +
"New note"; Spotlight surfaces recent notes first; the graph node inspector presents every
node *as a note*; the Reading theme (a notes setting) is an account-level page.

There are no in-page tabs; all brain sub-navigation is the sidebar.

---

## 2. Route map

`[ns]` = brain namespace. All pages are client components unless noted.

### Brain workspace

| Route | What it shows today | APIs | Verdict |
|---|---|---|---|
| `/brains` | Header + New brain; stat strip (brains, memories, nodes, recalls 24h, open gaps); search/sort/grid-list; `BrainCard`/`BrainRow` (avatar, name, memory count, last activity) | `GET /api/brain/namespaces`, `GET /api/brain/stats` (15 s), `GET /api/auth/me` | **REDESIGN** — cards answer "what/healthy/last learned/recalled/agents" |
| `/connect` | Static MCP connection guide (URL + per-client steps) | — | **MOVE** → Settings › Agents & MCP (keep route) |
| `/b/[ns]` | Brain header; 6 stats (memories, nodes, edges, recalls, gaps, secrets); "Ask this brain" band (≤4 suggestions); **Recent notes**; 680 px graph; 8 activity rows | `GET brain`, `GET graph?limit=3000`, `GET secrets` (count), `GET activity?limit=200` (client-filtered), `GET/POST /api/notes` | **REDESIGN** — the flagship screen |
| `/b/[ns]/notes` | List (search, sort, category/tag filter, list/tree, All·Pinned·Archived, date groups, infinite scroll) + editor (tabs, WYSIWYG, versions, conflict view, backlinks, related) | `/api/notes*`, `graph/roots`, `graph/neighbors`, `ontology` | **REDESIGN** — 3-pane with Knowledge context |
| `/b/[ns]/presentations`, `/[id]` | Deck list + editor + export route | `/api/presentations*` | **KEEP** (moves under "Create" group) |
| `/b/[ns]/chat` | "Ask the {ns}": suggestions, messages with citations + provenance footer; history in sessionStorage; `?q=` | `POST chat`, `GET graph` | **MOVE + REDESIGN** → **Ask** (`/b/[ns]/ask`; `/chat` redirects) |
| `/b/[ns]/search` | Recall/Search toggle, limit, filters (network, type, source kind, importance), rows, memory dialog | `POST recall`, `POST search`, `GET memory`, `POST memory/edit` | **REDESIGN** — results + detail panel; becomes the search half of **Memory** |
| `/b/[ns]/sources` | Add source; stats (sources, docs, errors, last sync); source rows | `GET/POST datasources` (3 s/15 s poll), `sync`, `delete` | **REDESIGN** — source health |
| `/b/[ns]/sessions` | Write toggle + **Mint** → token + MCP config | `POST /api/brain/session` | **MOVE** → Agents & MCP › "Launch a session". `/sessions` becomes the Sessions *history* view |
| `/b/[ns]/gaps` | Status filter, rows by status with hits, mark indexed / dismiss / reopen | `GET gaps?status` ×N, `POST gaps/resolve` | **REDESIGN** — human-language gaps |
| `/b/[ns]/activity` | Stats (ops, recalls, writes, errors) + log | `GET activity?limit=200` (client-filtered) | **KEEP + REDESIGN** (server-side filter) |
| `/b/[ns]/settings` | General, Appearance, Members, GitHub sync, Share domains, Danger | `profile`, `members`, `notes/github`, `export`, `brain/delete`, `ontology` | **KEEP** as Settings › General; Members **MOVE** → Permissions |
| `/b/[ns]/secrets` | Filter, list, reveal/edit/delete, add dialog | `/api/brain/secrets*` | **KEEP** |
| `/b/[ns]/permissions` | Agents with access, admins, add access | `GET tokens` (global-admin), `grant`, `grant/revoke` | **REDESIGN** — "who can remember what" (users + agents + apps) |

### Account, admin, public

| Route | Purpose | Verdict |
|---|---|---|
| `/account` (+ `security`, `connections`, `apps`, `notifications`, `reading`, `export`, `delete`) | Profile, 2FA, linked sign-ins, OAuth apps, notifications, reading theme (local), export, delete | **KEEP**; `apps` is linked from Agents & MCP too |
| `/admin` (+ `users`, `users/[id]`, `brains`, `presentations`, `tokens`, `search`, `activity`, `settings`) | Operator console | **KEEP**; `admin/search` → global search becomes available to everyone (scoped to readable brains) |
| `/dashboard` | Server redirect → `/admin` (social sign-in landing) | **KEEP** |
| `/login`, `/register`, `/forgot-password`, `/verify-email`, `/cancel-deletion`, `/oauth/authorize` | Auth + OAuth consent | **KEEP** |
| `/p/[token]`, `/p/[token]/embed/[id]`, `/p/[token]/download/[format]` | Public presentation share | **KEEP** |
| `zsite/*` | Marketing + docs (zekra.dev via proxy rewrite) | **KEEP** (out of scope) |

Redirect logic lives in `web/proxy.ts` (locale prefix, session cookie → `/brains`, protected
prefixes → `/login?next=`). Data layer: `web/lib/api.ts` (same-origin, CSRF, `ApiError`),
`web/lib/realtime.tsx` (one SSE stream `/api/brain/events`, 400 ms coalesce, refetches
`/api/brain/*`, `/api/notes`, `/api/me/notifications`).

---

## 3. Backend surface the UI can use (facts, not wishes)

### Data model (`plugins/brain/internal/brain/schema.sql`)

| Table | What matters for UX |
|---|---|
| `memories` (partitioned by `valid_at`) | `memory_type` ∈ episodic/semantic/procedural/working (`working` never auto-assigned); `network` ∈ fact/experience/observation/belief (only fact/experience auto-assigned); `source_kind` free text (`note`, `chat`, `datasource:<kind>`, …); `source_ref`; `importance`; `access_count` + `last_accessed_at` (bumped by recall **and** by duplicate writes); `valid_at`, `invalid_at`, `superseded_by`; `tier` (cold never set); `ingested_at`; `metadata` (tags/type/datasource live here — no tags column) |
| `entities`, `memory_entities`, `entity_edges` | Typed entities (`entity_type`, default `entity`), edges with `relation`, `fact`, `weight`, `valid_from/to`, `metadata.origin` (manual/wikilink/extract/cognee) |
| `memory_events` | The only activity log: `ts, namespace, op, memory_id, agent_id, latency_ms, metadata`. **Recall/search rows carry no agent, query, or result ids today.** |
| `memory_gaps` | `query, hits, status (open/indexed/dismissed), resolution, first_seen, last_seen` |
| `datasources` | `kind, name, status (idle/syncing/ok/error), last_error, doc_count (chunks, incl. dups), last_sync_at` — no sync history |
| `notes`, `note_versions` | Notes with `tags[]`, `category`, `entity_id`, `indexed_version`, `index_error`; versions carry `author_user_id`/`author_agent` |
| `namespace_grants`, `brain_members`, `brain_tokens`, `mcp_oauth_*` | Agent grants (read/write), user roles (owner/editor/viewer), tokens (`last_used_at`), OAuth clients + grants (`client_name`, `last_used_at`, per-brain `can_write`) |
| `brain_profiles`, `presentations*`, `secrets`, `note_github_sync`, `brain_notifications`, `device_tokens` | Profile/appearance, decks, vault, GitHub sync, inbox, push |

### Endpoints per screen need

| Need | Endpoint today | Shape notes |
|---|---|---|
| Brain list | `GET /api/brain/namespaces` | `{namespace, memories, lastAt (=MAX(valid_at), wrong for "last learned"), profile…}` |
| Brain detail | `GET /api/brain/brain` | `{memories, types{metadata.type}, sources{source_kind}, openGaps, recalls (all-time), firstAt, lastAt, role, canWrite}` |
| Global stats | `GET /api/brain/stats` | `{brains, memories, entities, edges (actually counts memory_entities — bug), agents (distinct owner labels), sessions24h (distinct source_ref — not sessions), recalls24h, openGaps}` |
| Recall | `POST /api/brain/recall` | rich filters (types, excludeSourceKinds, since/until/asOf, orderBy relevance/recent/oldest); result `{id, content, score, network, memoryType, sourceKind, sourceRef, importance, validAt, viaEntity?}` |
| Search (cross-brain) | `POST /api/brain/search` | same row + `namespace`; `score` = RRF (~0–0.04) or cosine or rerank — **not a percentage** |
| One memory | `GET /api/brain/memory` | full row incl. `accessCount, tier, invalidAt, supersededBy, metadata`; no entities, no `ingestedAt` |
| Ask | `POST /api/brain/chat` | `{answer, citations: Recalled[], footprint{recalled, model, provider, mode, grounded, steps[], latencyMs}}` |
| Graph | `graph`, `graph/traverse`, `neighbors`, `path`, `spine`, `roots`, `ontology`, `entities/{id}` | entity detail returns edges + up to 20 memories; graph payload has `sampled`/`derived` flags |
| Notes | `/api/notes*` incl. `/{id}/related`, `/{id}/backlinks` | related/backlinks come from the entity graph |
| Gaps | `GET /api/brain/gaps`, `POST gaps/resolve` | no `resolved_at`, no link to the answering memory |
| Sources | `GET /api/brain/datasources` | status + last error + last sync |
| Activity | `GET /api/brain/activity?limit` | **no namespace/op/agent filter** (UI filters client-side) |
| Sessions | `POST /api/brain/session` | mints a token; **no list/detail** |
| Agents for a brain | — | **none**: OAuth grants are per user (`/api/oauth/grants`), tokens are global-admin |

### MCP (`plugins/brain/mcptools`, `mcp_http.go`)

40+ tools (memory_*, brain_*, graph_*, note_*, entity/edge_*, secret_*, datasource_*,
presentation_*). Caller identity: OAuth → `oauth:<client_name>`; hub token →
`oauth:CircleXO agent <id>`; access token → its `agent_id`. `Mcp-Session-Id` is issued on
initialize and echoed (`mcp_http.go:265`) but **not recorded**. Identity is recorded only on
shares, note versions, secrets, token/grant `last_used_at`, and hub metering — **not on
recall, search, forget or (via MCP) retain**.

---

## 4. Design system in use

`@fadymondy/nasaq@^0.1.0` (`/web` entry), provider `NasaqProvider brand="zekra"`, dark by
default, compact density. Tokens: shadcn-style vars + `--nq-*` (surfaces, fg, success/warning/
danger/info with `-soft`/`-text`, brand/action `#6D4DE6`, accent gold `#C9A227`, tag palette
gray/red/orange/amber/green/teal/blue/violet/pink). Graph series colours `--zk-series-1..3`
scoped to `.zk-graph` (`web/components/graph/colors.ts`).

Used today: Button, Badge, Input, toast, Field, Select, Dialog/AlertDialog/Sheet/Popover,
DropdownMenu, Table, Skeleton, Alert, Collapsible, Card (2 uses), Chart, CodeBlock, Progress,
Status, AppShell/Sidebar, CommandPalette, UserMenu, LocaleSwitcher.

**Shipped by Nasaq but unused** — directly relevant to this redesign: `StatCard`/`StatGrid`,
`MetricTiles`, `Sparkline`, `ProgressRing`, `BrainCard`/`BrainList`, `KnowledgeGaps`,
`GraphView`, `TreeView`, `Timeline`/`ActivityTimeline`, `AiSourceChips`/citations,
`SourceBadge`/`SourcesCatalogue`, `EntityList`, `DataTable`, `EmptyState`/`ErrorState`/
`LoadingState`, `Tabs`, `Resizable`.

Local widgets worth keeping: `BrainAvatar/BrainCard/BrainRow`, `BrainTitle`, `ActivityRow`,
`chat/provenance.tsx`, `markdown-answer.tsx` (citation chips), `BrainGraphView`/`spider-view`,
`mindmap.tsx` (unused), `node-inspector.tsx`, `node-links.tsx`, `entity-tree.tsx`,
`memory-dialog.tsx`, `source-row.tsx`/`add-source-dialog.tsx`, `spotlight.tsx`, `page.tsx`
section primitives, `states.tsx`.

---

## 5. Defects found during the audit

| # | Defect | Where |
|---|---|---|
| D1 | "All presentations" in the Brains sidebar links an admin-only page | `web/lib/nav.ts` |
| D2 | `Stats.Edges` counts `memory_entities`, not `entity_edges` | `queries.go:50` |
| D3 | `lastAt` uses `MAX(valid_at)` (event time, can be backdated) — wrong for "last learned" | `queries.go:109`, `admin.go:16-52` |
| D4 | `adopt` events violate `memory_events_op_chk` and fail silently | `notes_adopt.go:676` vs `schema.sql:318` |
| D5 | Recall cache hits log outcome `hit` even when the cached result is empty | `store.go:539` |
| D6 | `access_count` is bumped by duplicate writes, so it is not a pure recall counter | `store.go:337-339` |
| D7 | Recall/search/forget events store `agent_id = ""`; MCP retain never sets an owner | `store.go:539,606`, `search.go:118`, `ops.go:164`, `dispatch.go` |
| D8 | `Sessions24h` is distinct `source_ref`, not sessions | `queries.go:52` |
| D9 | `datasource.doc_count` sums chunks incl. duplicates; memories link to a source by *name* | `datasource.go:222-271` |
| D10 | Overview pulls `graph?limit=3000` and `activity?limit=200` and filters in the browser | `b/[ns]/page.tsx` |
| D11 | Nasaq's Arabic brand spelling (ذكرة) differs from the app's (ذكرى, `7340037`) | Nasaq manifests |
| D12 | Creating a brain writes a `source_kind='system'` seed memory, so every new brain "has learned" one thing | `web/components/brains/brain-dialogs.tsx:74` |

### `source_kind` values actually written

`note` (notes indexing), `chat` (Ask write-back, `agent.go:173`), `datasource:<kind>`
(ingestion), `system` (brain-creation seed, written by the clients), `manual` (API docs/tests),
`mcp` (tests only). Ingestion scripts may write anything else (claude_code, slack, flowos…);
the column has no CHECK. **Source facets must be built from `SELECT DISTINCT source_kind`,
never a fixed list, and `system` must be excluded from "learned" metrics.**
