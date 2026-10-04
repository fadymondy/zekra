# Zekra — target information architecture

The redesign turns Zekra from "a notes app with a graph" into **an inspectable memory organ
for AI**. Every screen must answer, without explanation: *what does this brain know, where did
it come from, how is it connected, which AI used it, what was recalled, is it trustworthy,
what's missing?*

Mental model, made visible across the product:

```
BRAIN → MEMORY → KNOWLEDGE GRAPH → RECALL → AI / AGENT → NEW KNOWLEDGE → MEMORY
```

Tagline (empty states, onboarding, brains page): **"Give your AI a memory that survives every
session."** Sub-line: *Persistent, inspectable, grounded memory for AI.*

Ground rule — **never fabricate intelligence.** A label such as *Grounded*, *Conflict*,
*Stale*, *Gap*, *Related* or *Match* appears only when a backend signal backs it (see
[CAPABILITY-GAPS](ZEKRA-CAPABILITY-GAPS.md)). Where the signal doesn't exist yet, the UI shows
a designed "not tracked yet" state, never an invented number.

---

## 1. Navigation

### Brain sidebar (`brainNav(ns)`)

| Group | Item | Route | Notes |
|---|---|---|---|
| — | **Overview** | `/b/[ns]` | The flagship screen |
| — | **Memory** | `/b/[ns]/memory` | Explorer + search (absorbs `/search`) |
| — | **Graph** | `/b/[ns]/graph` | Full-screen exploration (graph leaves Overview as a preview) |
| — | **Ask** | `/b/[ns]/ask` | Grounded chat (`/chat` redirects) |
| — | **Notes** | `/b/[ns]/notes` | Human-authored knowledge; important, not central |
| — | **Sources** | `/b/[ns]/sources` | Where knowledge comes from |
| Observe | **Recalls** | `/b/[ns]/recalls` | First-class: what AI asked and got |
| Observe | **Sessions** | `/b/[ns]/sessions` | Per-agent session history (+ "Launch a session") |
| Observe | **Gaps** | `/b/[ns]/gaps` | What the brain couldn't answer |
| Observe | **Activity** | `/b/[ns]/activity` | Raw event log |
| Create | Presentations | `/b/[ns]/presentations` | Kept, demoted to a secondary group |
| Settings | **Agents & MCP** | `/b/[ns]/agents` | Who can remember what |
| Settings | **Permissions** | `/b/[ns]/permissions` | Users + agents + apps, by capability |
| Settings | **Secrets** | `/b/[ns]/secrets` | Unchanged |
| Settings | **General** | `/b/[ns]/settings` | Profile, appearance, GitHub sync, share domains, danger |

The Brains-level sidebar drops the admin-only "All presentations" link for non-admins (D1) and
renames "Connect an agent" → "Connect AI" (it now deep-links Agents & MCP).

### Global

- **Global search** (⌘K → "Search all brains", and `/search`): cross-brain `POST /api/brain/search`
  restricted server-side to readable brains, with a brain facet. `admin/search` remains for
  operators.
- Top bar unchanged: brain switcher · Spotlight · Live · Notifications · User.

---

## 2. Screens

### 2.1 Brains (`/brains`)

Cards answer *what is it / how much does it know / is it healthy / when did it last learn /
how often is it recalled / are there gaps / which agents use it*.

```
┌ Brain avatar  Name                         ● Healthy ┐
│ Description (profile.description, 2 lines)           │
│ 1,782 memories · 6 sources · learned 2h ago          │
│ 214 recalls this week   ▁▃▅▂▇ (7-day sparkline)      │
│ 3 open gaps        Claude Code · Cursor  +2          │
└──────────────────────────────────────────────────────┘
```

- Memory count excludes `system`. "Learned" = `MAX(ingested_at)`. Recalls = 7-day count from
  `memory_events`. Agents = distinct caller identities in the last 30 days (needs P1).
- Health dot (§3) is derived, never a score.
- The stat strip keeps totals but swaps "nodes" for "recalls this week".
- Empty: the onboarding checklist (§4).

### 2.2 Brain Overview (`/b/[ns]`) — the most important screen

Desktop layout (12-col); main column 8, side column 4:

```
Header: avatar · name · description · role badge · status   [Agents: ●Claude ●Cursor  Manage agents]
Metrics: Knowledge (memories · entities) | Recalls this week (+Δ vs prior week) | Grounded % * | Open gaps
┌ Ask this brain ───────────────────────────────┐ ┌ Memory health ─────────┐
│ [ input ]                                     │ │ ✓ 92% have a source    │
│ suggestions from top entities / recent titles │ │ ! 14 invalidated       │
└───────────────────────────────────────────────┘ │ ! 2 sources erroring   │
┌ What this brain knows ────────────────────────┐ │ · 31 not recalled 90d  │
│ by type (semantic/episodic/…) · by source     │ │ · 5 orphan entities    │
│ (note/github/crawler…) · top entity types     │ └────────────────────────┘
└───────────────────────────────────────────────┘ ┌ Recent recalls ────────┐
┌ Recently learned ─────────────────────────────┐ │ agent · query · n used │
│ title/preview · type chip · source · time     │ │ · time                 │
└───────────────────────────────────────────────┘ └────────────────────────┘
┌ Graph preview (≤150 nodes, spine) ───── Explore full graph → ┐
```

\* Grounded % renders only once chat grounding is persisted (G5); until then the tile is
omitted, not zeroed.

Data: one `GET /api/brain/overview?ns=` (P1) instead of today's graph-3000 + activity-200 fetch.

### 2.3 Memory (`/b/[ns]/memory`) — explorer + search

- **Browse mode** (no query): `GET /api/brain/memories` (cursor-paged, newest first) with facets
  type · network · source kind · tag · entity · date range · contributor/agent · state
  (active / invalidated / superseded).
- **Search mode** (query typed): `POST /api/brain/recall` with the same filters mapped to
  `types`, `excludeSourceKinds`, `since/until`, `orderBy`.
- Row: preview (2 lines) · type chip · source badge · entities (≤3) · tags · learned · last recalled.
- Relevance: rank order only. A "Strong match" label appears only on reranked results above a
  documented threshold (§3); RRF scores are never shown.
- Selecting a row opens the **Memory detail drawer** (desktop: right panel; mobile: full sheet).

**Memory detail** sections:

| Section | Content | Backed by |
|---|---|---|
| What | full content, type, network, importance | `GET memory` |
| Why it exists | write decision (new / updated / merged), the memory it supersedes | retain event metadata, `superseded_by` |
| Source | source kind + ref, datasource link, note link, ingested at | `source_kind/ref`, `metadata.datasource` |
| Relationships | linked entities + their edges | `memory_entities`, `entity_edges` |
| Usage | times recalled, last recalled, which agents recalled it | `access_count`, recall events with result ids (P1) |
| History | valid from/to, invalidated, superseded chain, edits | `valid_at`, `invalid_at`, `superseded_by`, edit events (P1) |

Actions: Edit · Forget · Ask about this · Explore in graph · Open source.

### 2.4 Graph (`/b/[ns]/graph`)

Exploration, not a wall of nodes:
- Start from the spine/roots (≤150 nodes) or a searched entity. Expand on click via
  `graph/neighbors`; depth 1–3 via `graph/traverse`.
- Controls: entity search · node-type filter (from `ontology`) · relation filter · depth · focus
  mode (dim everything not within N hops) · path between two nodes (`graph/path`).
- Node drawer: entity identity, edges grouped by relation, memories (up to 20 from
  `entities/{id}`), notes, sources. "Ask about X" → Ask.
- Colours: semantic entity-type tokens (§5).

### 2.5 Ask (`/b/[ns]/ask`)

Grounded chat. Each answer shows: inline citation chips · "Memories used" (expandable list →
detail drawer) · entities mentioned · model + provider · mode · latency · timestamp.
`footprint.grounded=false` → a neutral "Answered without memory support" notice (it is a real
flag). No confidence numbers. Ungrounded answers offer "Record as a gap".

### 2.6 Notes (`/b/[ns]/notes`)

Three panes (desktop), collapsible (tablet), stacked (mobile):
- **Left — browser:** search · All / Pinned / Shared\* / Archived · rows with icon, title,
  description, tags, updated time. Tree view kept as a toggle.
- **Centre — editor:** unchanged TipTap editor, tabs, versions, conflict view.
- **Right — knowledge context:** Summary\* · table of contents (from headings) · related
  memories (`/notes/{id}/related`) · entities (note's entity + neighbours) · backlinks · sources
  · recent recalls of this note's memories\*.

\* *Shared* needs a share flag on notes (not tracked today → hidden). *Summary* needs a stored
summary (not tracked → hidden). *Recent recalls* needs P1 result ids.

### 2.7 Sources (`/b/[ns]/sources`)

Each source: kind icon · name · status (idle/syncing/ok/error) · memories contributed (real
count of memories with `metadata.datasource = name`, not `doc_count`) · last sync · last error
· Sync / Edit / Remove. Header: total sources, erroring, last successful sync. A "Sources"
panel also lists non-datasource origins (notes, chat, MCP agents) from `DISTINCT source_kind`.

### 2.8 Recalls (`/b/[ns]/recalls`) — new, first-class

A list of recall/search events: time · agent (identity + client kind) · query · results
returned (count; expand → the memory ids/titles) · outcome (hit / empty → gap link) · latency
· source kinds of what was returned. Filters: agent, outcome, date. Requires P1 telemetry; until
deployed, the page explains that recall logging starts from the deploy date.

"Was it useful?" is **not tracked** (no feedback signal) — shown as a capability gap, not a
column.

### 2.9 Sessions (`/b/[ns]/sessions`)

A session = one MCP session id (or, without one, a 30-minute inactivity window per agent).
List: agent · started · duration · recalls · retains · gaps. Detail timeline: Ask · Recall ·
Tool call · New memory · Decision (retain with `network=belief`/`type=decision` metadata) ·
End. The current token-minting UI becomes a "Launch a session" dialog on this page and on
Agents & MCP.

### 2.10 Gaps (`/b/[ns]/gaps`)

Each gap in human language: *"Agents asked about '{query}' {hits} times since {first_seen};
the brain had nothing."* Related items: nearest memories by a low-threshold recall (labelled
"closest existing memories", not "answers"). Actions: **Answer gap** (create a note prefilled
with the question, then mark indexed) · **Attach source** · **Ask agent** (open Ask with the
query) · Dismiss. No automatic "why" explanation (backend can't produce one).

### 2.11 Agents & MCP (`/b/[ns]/agents`)

"Who can remember what." Rows for every identity with access to this brain:
- OAuth apps (`mcp_oauth_grants` for this namespace) — client name, read/write, last used.
- Agent tokens / grants (`namespace_grants`, `brain_tokens`) — agent id, access, last used.
- Recent activity per identity (from P1 events): last recall, recall count 7d, retains 7d.
Plus: the connection guide (moved from `/connect`), "Launch a session", revoke.

### 2.12 Permissions (`/b/[ns]/permissions`)

One matrix, readable by non-engineers: rows = users (owner/editor/viewer) + agents + apps;
columns = capabilities (Read memory · Write memory · Manage sources · Manage secrets · Manage
members). Values derive from role/grant; no raw ACL editing.

### 2.13 Activity, Secrets, General — kept; Activity gains server-side filters.

---

## 3. Derived signals (deterministic rules only)

| Signal | Rule | Shown when |
|---|---|---|
| Health dot | **Attention** if any source is in `error` or open gaps ≥ 5; **Quiet** if no recall in 14 d; else **Healthy** | always (rule text in tooltip) |
| With a source | share of active memories whose `source_kind` ∉ {'', `system`} or `source_ref` ≠ '' | always |
| Invalidated | `invalid_at IS NOT NULL` (labelled "invalidated", **not** "conflict") | > 0 |
| Superseded | `superseded_by IS NOT NULL` | > 0 |
| Not recalled 90 d | active, `ingested_at` < now-90d and (`last_accessed_at` IS NULL or < now-90d) — labelled "unused", **not** "stale" | > 0 |
| Orphan entities | entities with no `memory_entities` row | > 0 |
| Source erroring | `datasources.status = 'error'` | > 0 |
| Strong match | reranker score ≥ 0.5 on rerank-mode results only | rerank on |
| Grounded % | share of persisted chat answers with `grounded=true`, 30 d | after G5 |

---

## 4. Onboarding and empty states

Checklist on `/brains` (no brains) and on a new brain's Overview, each step computed:

1. Create a brain — has ≥1 brain.
2. Add knowledge — ≥1 memory with `source_kind ≠ system`.
3. Connect your AI — ≥1 OAuth grant / token for the brain.
4. Ask the first question — ≥1 chat or recall event.
5. See the first recall — ≥1 recall event from an agent (P1) → links to that recall.

Empty states teach: each says what the screen will hold, why it matters, and the one action
that fills it (e.g. Recalls: "When an AI recalls from this brain, you'll see what it asked and
which memories it used. Connect an AI →").

The "aha": a recall row → its memories → each memory's source. That chain must work in ≤2 clicks.

---

## 5. Visual language

- Keep Nasaq and its tokens; no new design system, no neon glows.
- Semantic type colours map to Nasaq tag tokens (`--nq-tag-*` + `-soft`):

| Kind | Token |
|---|---|
| Memory (semantic) | violet |
| Episodic / conversation | pink |
| Procedural | teal |
| Decision / belief | orange |
| Note | blue-cyan (`tag-blue`) |
| Document / datasource | blue |
| Entity | green |
| Source / system | gray |
| Gap | amber |
| Invalidated | red |

- Hierarchy: one primary number per tile, label above, context below. Sections use Nasaq
  `Card` with a header row (title + one action). No decorative charts: sparklines only where a
  time series exists (recalls/day).
- Reuse Nasaq `StatCard`, `Sparkline`, `DataTable` (+facets), `Timeline`, `EmptyState`,
  `SourceBadge`, `AiSourceChips`, `Tabs`, `Resizable`, `Sheet`.

## 6. Responsive

- **Desktop ≥1280:** multi-column (Overview 8/4, Memory list + drawer, Notes 3-pane).
- **Tablet 768–1279:** side panels collapse to toggles/sheets; Overview single column with
  health + recalls after metrics.
- **Mobile <768:** Overview order = Ask · metrics · Recent recalls · Recently learned; graph
  becomes "focused mode" (one entity + neighbours, full-screen sheet); drawers are full sheets.
  Desktop/mobile *apps* are out of scope (owned by another agent).
