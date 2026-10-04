# Zekra — capability gaps behind the redesign

The redesign's data-integrity rule: *the UI shows a signal only if the backend can prove it.*
This file lists every signal the target IA wants, whether the backend has it today, and what
must be added. Status: **EXISTS** (query it) · **DERIVABLE** (computable from stored data, needs
an endpoint) · **MISSING** (not stored; needs new telemetry or a new feature).

## 1. Signal inventory

| # | Signal | Status | Evidence / where it would come from |
|---|---|---|---|
| S1 | Memory count, by type / network / source kind | EXISTS | `memories`, `GET /api/brain/brain` (types = `metadata.type`, sources = `source_kind`) |
| S2 | Last learned | DERIVABLE | `MAX(ingested_at)`; today's `lastAt` uses `valid_at` (D3) |
| S3 | Recalls this week / per day | DERIVABLE | `memory_events` op ∈ (recall, search), index `(namespace, ts DESC)`; today only all-time + 24h |
| S4 | Which agent recalled | **MISSING** | recall/search events write `agent_id = ''` (D7) |
| S5 | What was asked (query) | **MISSING** | not logged (only gaps store the query, on empty recall) |
| S6 | What was returned (memory ids) | **MISSING** | not logged; `access_count` is a counter only |
| S7 | Last recalled per memory | EXISTS* | `last_accessed_at` — *also bumped by duplicate writes (D6)* |
| S8 | Agents using a brain | DERIVABLE (weak) | OAuth grants + tokens + `last_used_at`; activity per agent needs S4 |
| S9 | Sessions | **MISSING** | no table; `Mcp-Session-Id` issued but not stored; `sessions24h` is distinct `source_ref` (D8) |
| S10 | Grounded % | **MISSING** | `footprint.grounded` computed per chat answer, not persisted |
| S11 | Useful recall (feedback) | **MISSING** | no feedback signal anywhere |
| S12 | Conflicts | **MISSING** | no contradiction detection; write-decision only invalidates on negation words |
| S13 | Invalidated / superseded memories | EXISTS | `invalid_at`, `superseded_by` (proxy for "conflict" — must be labelled as such) |
| S14 | Stale memory | DERIVABLE by rule | no notion of staleness; use an explicit "unused 90 d" rule, never "stale" |
| S15 | Orphan entities | DERIVABLE | entities with no `memory_entities` |
| S16 | Memories with a source | EXISTS | `source_kind`/`source_ref` (exclude `system`) |
| S17 | Why a memory exists (write decision) | EXISTS (partial) | retain event `metadata` holds the decision outcome; not exposed per memory |
| S18 | Memory edit history | **MISSING** | `EditMemory` and `Dedup` log no event; notes have `note_versions` |
| S19 | Contributors | DERIVABLE (weak) | `owner_agent_id` set only if the body supplies it — MCP retain never does (D7) |
| S20 | Memories per source | DERIVABLE | `metadata->>'datasource' = name`; `doc_count` overcounts (D9) |
| S21 | Source sync history | **MISSING** | only the latest status/error/time |
| S22 | Gap resolution trail | **MISSING** | no `resolved_at`, no link to the answering memory/note |
| S23 | Gap explanation ("why") | **MISSING** | not produced; show the raw facts only |
| S24 | Semantic match label | EXISTS (rerank only) | rerank scores are calibrated-ish; RRF (~0–0.04) and cosine are not — never as % |
| S25 | Memory browse/list | **MISSING endpoint** | only `GET memory` (one row) and recall/search |
| S26 | Note "Shared" filter | **MISSING** | notes have no share flag (presentations do) |
| S27 | Note summary | **MISSING** | not stored |
| S28 | Activity filters | DERIVABLE | `GET activity` takes only `limit` |
| S29 | Per-capability permissions | DERIVABLE | role (owner/editor/viewer) + grant `can_write`; no finer ACL |

## 2. Backend additions (P1 — telemetry foundation)

Ordered so each is a small, deployable task.

1. **Recall telemetry** (S4–S6, D5). On `recall`, `recall_archive`, `search`:
   `agent_id` = resolved caller; `metadata` = `{query, client: oauth|token|user|hub,
   session: <Mcp-Session-Id|''>, results: [ids ≤ 20], top_score, mode, outcome}`. Fix D5 by
   logging `empty` for empty cached results. Thread caller + session via context from
   `mcp_http.go` / REST handlers.
   *Privacy:* the query text becomes stored data. Keep it inside the brain's namespace, visible
   only to members with read access, deleted with the brain; add `ZEKRA_LOG_RECALL_QUERIES`
   (default on) to disable it per instance.
2. **Retain/forget identity** (S19, D7): default `owner_agent_id` to the caller when the body
   omits it; set `agent_id` on forget/edit events.
3. **Missing events** (S18, D4): add `edit`, `dedup`, `adopt` to `memory_events_op_chk`
   (migration) and log them.
4. **Correctness fixes**: D2 (`Stats.Edges` → `entity_edges`), D3 (`lastAt` → `ingested_at`),
   D12 (exclude `system` from learned metrics).
5. **`GET /api/brain/overview?namespace=`** → `{memories, entities, edges, lastLearnedAt,
   recalls7d, recallsPrev7d, recallsByDay[7], openGaps, byType, byNetwork, bySource,
   topEntityTypes, recentlyLearned[8], recentRecalls[8], agents[{id, client, lastSeen,
   recalls7d}], health{withSource, invalidated, superseded, unused90d, orphanEntities,
   sourcesErroring}}`.
6. **`GET /api/brain/memories`** (S25): cursor-paged; filters `type, network, sourceKind, tag,
   entity, since, until, agent, state (active|invalidated|superseded)`; returns rows with
   entities (≤3), tags, `ingestedAt`, `lastAccessedAt`, `accessCount`.
7. **`GET /api/brain/memory` enrichment**: add `ingestedAt`, entities, write-decision metadata,
   supersedes/superseded-by, usage (recall events referencing the id, agents, last 20).
8. **`GET /api/brain/recalls`** (S3–S6): recall events with filters `agent, outcome, since`.
9. **`GET /api/brain/agents?namespace=`** (S8): union of OAuth grants, namespace grants and
   tokens for the brain, joined with per-agent event counts.
10. **Activity filters** (S28): `namespace, op, agent, since` on `GET /api/brain/activity`.
11. **Persist chat grounding** (S10): log a `reflect`-style event (or `chat` op) with
    `{grounded, citations, model}`; enables Grounded %.
12. **Sessions** (S9): derive from `metadata.session` (MCP) or 30-min windows per agent →
    `GET /api/brain/sessions`, `GET /api/brain/sessions/{id}` (timeline of events).
13. **Source memory counts** (S20): count by `metadata->>'datasource'` in the datasources list.

## 3. Deliberately not built (designed states instead)

| Signal | UI state |
|---|---|
| Conflicts (S12) | Health shows "Invalidated" + "Superseded" counts. Interface `Conflict {a, b, reason, detectedAt}` reserved in `web/lib/types`; no conflict UI until a detector exists. |
| Useful recall (S11) | Recalls page has no "useful" column; a note says feedback isn't collected yet. Future: `POST /api/brain/recalls/{id}/feedback`. |
| Gap explanation (S23) | Show facts (query, hits, first/last seen) + closest memories; no generated "why". |
| Source sync history (S21) | Show latest status only. |
| Note Shared / Summary (S26–27) | Filter and section hidden. |
| Stale (S14) | Only "Unused 90 d" by explicit rule. |

## 4. Front-end guardrails

- `score` is never rendered as a number or a percentage. Order conveys relevance.
- Any derived label carries its rule in a tooltip ("No recall in 14 days").
- Telemetry that starts at a deploy date says so ("Recall history since 5 Oct 2026").
- Unknown agent identity is shown as "Unknown agent", never guessed.
