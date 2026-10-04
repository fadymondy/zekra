# Zekra — UX migration plan

How we get from [CURRENT-IA](ZEKRA-CURRENT-IA.md) to [TARGET-IA](ZEKRA-TARGET-IA.md) without
breaking a working feature or a bookmarked URL. Every phase is shipped as its own commits,
pushed and deployed to production (LXC 109) before the next starts. Desktop/mobile apps are out
of scope.

## 1. Feature verdicts

| Feature (today) | Verdict | Destination |
|---|---|---|
| Brains list + cards | REDESIGN | `/brains` cards with learned/recalls/gaps/agents/health |
| `/connect` guide | MOVE | Agents & MCP › Connect (route kept, links there) |
| Brain Overview | REDESIGN | New Overview (§2.2); graph → preview |
| Overview "Recent notes" | MOVE | Notes; Overview shows *Recently learned* (all sources) |
| Overview full graph | MOVE | `/b/[ns]/graph` |
| Overview secrets count | DEPRECATE | Secrets page only (not a knowledge metric) |
| Notes list/editor | REDESIGN | 3-pane Notes with knowledge context |
| Notes tree view | KEEP | Toggle in the Notes browser |
| Presentations | KEEP | "Create" group |
| Chat | MOVE + REDESIGN | **Ask** `/b/[ns]/ask`; `/chat` redirects |
| Search (recall/search toggle) | MERGE | **Memory** `/b/[ns]/memory`; `/search` redirects (query preserved) |
| Memory dialog | REDESIGN | Memory detail drawer |
| Sources | REDESIGN | Source health rows |
| Sessions (token mint) | MOVE | "Launch a session" dialog (Sessions + Agents & MCP) |
| Sessions route | REDESIGN | Session history + timeline |
| Gaps | REDESIGN | Human-language gaps + actions |
| Activity | KEEP | Observe › Activity, server-side filters |
| Settings | KEEP | Settings › General |
| Settings › Members | MOVE | Permissions |
| Secrets | KEEP | Settings › Secrets |
| Permissions | REDESIGN | Capability matrix (users + agents + apps) |
| Account pages | KEEP | — |
| Account › Connected apps | KEEP | also linked from Agents & MCP |
| Admin console | KEEP | — |
| Admin global search | KEEP | plus user-level global search |
| Brains nav "All presentations" | DEPRECATE (for non-admins) | shown to admins only (fixes D1) |
| Spotlight | KEEP | adds Memory/Recalls targets, "Search all brains" |
| Graph node inspector (note-centric) | REDESIGN | Entity node drawer |
| `mindmap.tsx` (unused) | DEPRECATE | left in place, unlinked |

## 2. Route compatibility

| Old | New | Mechanism |
|---|---|---|
| `/b/[ns]/chat` | `/b/[ns]/ask` | Next `redirect()` page, keeps `?q=` |
| `/b/[ns]/search` | `/b/[ns]/memory` | redirect, keeps `?q=` |
| `/b/[ns]/sessions` (mint) | same route, history view | mint lives in a dialog (`?launch=1` opens it) |
| `/connect` | `/connect` (kept) | links to each brain's Agents & MCP |
| all others | unchanged | — |

Locale prefix handling stays in `proxy.ts`; redirects are locale-aware.

## 3. Phases

| Phase | Scope | Ships |
|---|---|---|
| **P0** | These four docs | commit + push |
| **P1a** | Recall/search/forget telemetry (agent, client, session, query, result ids, outcome fix), owner default, op CHECK migration (`edit`, `dedup`, `adopt`), D2/D3/D12 fixes | API deploy (schema delta first) |
| **P1b** | `GET overview`, `GET memories`, enriched `GET memory`, `GET recalls`, `GET agents`, activity filters, source memory counts | API deploy |
| **P2** | New nav (`brainNav`), redirects, Brain Overview, Brains cards, onboarding checklist | web deploy |
| **P3** | Memory explorer + detail drawer (absorbs Search) | web deploy |
| **P4** | Recalls page, Agents & MCP, Permissions matrix | web deploy |
| **P5** | Ask redesign, Notes 3-pane + knowledge context, global search | web deploy |
| **P6** | Graph page + node drawer, Sources health, Gaps redesign, chat grounding persistence + Grounded %, Sessions history | API + web deploy |

Each phase: `go build ./... && go test ./plugins/brain/...` (API) / `npm run build` (web) →
commit → push → deploy (API: back up binary, apply schema delta, swap, restart `zekra.service`;
web: keep `/opt/zekra-web.prev`) → smoke test → refresh the `zekra` brain.

## 4. Rollback

- API: previous binary kept as `/opt/zekra/zekra-api.prev`; schema changes are additive
  (CHECK widening, new indexes) so the old binary still runs against the new schema.
- Web: `/opt/zekra-web.prev` swap back + restart `zekra-web.service`.
- Telemetry flag `ZEKRA_LOG_RECALL_QUERIES=false` disables query storage without a deploy.

## 5. Acceptance per screen

A screen is done when: every number on it maps to a row in CAPABILITY-GAPS marked EXISTS or
DERIVABLE (and implemented); its empty state teaches the next action; it works at 375 / 1024 /
1440 px in en and ar (RTL); and old URLs that pointed at it still land correctly.
