---
locale: en
title: "Zekra — Long-term memory for AI agents over MCP"
description: "A memory organ for AI agents. Long-term recall and an entity graph that any agent reaches over MCP — so what one session learns, the next one already knows."
source: web/content/site/landing.en.json
---

# Zekra

_MEMORY FOR AI AGENTS · OVER MCP_

A memory organ for AI agents. Long-term recall and an entity graph that any agent reaches over MCP — so what one session learns, the next one already knows.

[Open the app](https://app.zekra.dev) · [Read the docs](@docs)

- Remote MCP at mcp.zekra.dev
- OAuth sign-in for Claude.ai and ChatGPT
- Postgres · VectorChord · BM25
- Notes you and your agents share
- One CLI for Claude Code, Codex, Gemini, Cursor
- Console at app.zekra.dev

## Features

### Hybrid recall, not just vectors

Vector similarity and BM25 fused with reciprocal rank, then reranked. A name or an exact phrase is found by the half of the search that is good at names.

### Hot and cold, like a brain

A hippocampal hot tier answers fast; a cortical cold tier keeps everything. Salience-gated consolidation moves what matters between them while you are not looking.

### Reconsolidation on recall

Remembering something changes it — recall strengthens a memory and lets it be corrected, rather than leaving a stale fact to be retrieved for ever.

### Any client, one protocol

Claude Code and Desktop, Codex, Gemini CLI and Cursor connect through the zekra CLI. Claude.ai and ChatGPT connect to the remote server at mcp.zekra.dev and sign in with OAuth — no local binary.

### Every memory is a note

What an agent retains is a note you can read, tag, link and edit in the console — and every note is a node in the brain's entity graph.

### Scoped brains and a secrets vault

Each brain is granted per agent and per person, with scoped tokens. A credential pasted into a memory is moved into an encrypted vault instead of being stored as text.

## Turn what your team knows into decks, reports and pages — Arabic and English

_FOR YOUR TEAM_

The memory your agents build is also your team's. Zekra presentations start from a note, a recall query or a whole brain and draft a customer-ready deck, report or landing page from what the brain actually holds.

### From notes and brains

Pick notes, a query or a brain; the draft is built from those memories, not from a blank page.

### Deck, report or page

One source, three shapes: slides to present, a report to send, a page to publish.

### Arabic and English

Right-to-left Arabic is laid out properly, not mirrored as an afterthought.

### PDF and Word

Export a deck or report as PDF or as an editable Word document.

### Private share links

Share with a customer by link; the link is the only key, and you can revoke it.

### Owned by the brain

Presentations live with the brain they came from, under the same access grants.

## Get started

1. Install the CLI

   `curl -fsSL https://app.zekra.dev/install.sh | sh`

2. Log in with a token from the console

   `zekra auth login --token cbt_...`

3. Wire Zekra into your client

   `zekra mcp:install claude-code --brain my-project`

4. Or add it to Claude.ai or ChatGPT

   `https://mcp.zekra.dev`

## Why Zekra?

Four ways an agent can know something, from the shortest-lived to the longest.

## Status

Live. The console runs at app.zekra.dev and the remote MCP server at mcp.zekra.dev, on Postgres with VectorChord and BM25, embedding and reranking through TEI — retain, recall, notes and the entity graph are in daily use.

## Give your agents a memory.

Open the console to create a brain, mint a scoped token and connect Claude Code, Cursor, Claude.ai, ChatGPT or any MCP client.

[Open the app](https://app.zekra.dev) · [Star on GitHub](https://github.com/fadymondy/zekra)
