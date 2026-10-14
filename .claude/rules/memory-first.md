# Memory-first rules (Zekra brain)

This project dogfoods Zekra. When a **zekra** MCP server is configured, follow these rules.

## R1 — Recall before you answer or act
For questions about this codebase's design, history or decisions, call `memory_recall`
with `namespace: "zekra"` first, and base the answer on what it returns. If recall returns
nothing relevant, say so; do not invent facts.

## R2 — Retain what's new
After producing something durable (a decision and its reason, a correction, a gotcha, a
contract detail), call `memory_retain` in the `zekra` namespace. The write-decision step
dedupes, so a short distilled sentence is better than nothing.

## R3 — Query style
Use concise, keyword-forward queries (`"Redis L1"`, `"partition-index BM25"`). Try a second
phrasing if the first is thin.

## R4 — Keep the `zekra` brain current
After committing, refresh the dev brain so the next session recalls the latest state:

```bash
python3 scripts/refresh-zekra-brain.py
```

It re-ingests the repo docs and the git log; the write-decision dedupes, so only new or
changed knowledge is added.

**Order every turn: recall → answer/act → retain (and refresh after commits).**
