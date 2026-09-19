---
title: Introduction
description: Zekra is shared long-term memory for AI agents. Agents retain what they learn and recall it later, over MCP, a REST API or the zekra CLI.
order: 1
---

# Zekra

**Zekra (ذكرة) is shared long-term memory for AI agents.** An agent stores what it learns
in a *brain*. The next session, or another agent, recalls it. Coding agents, chat
assistants, your own agent fleet and your team all read from and write to the same memory.

Zekra was formerly called CaBrain.

You can reach Zekra in three ways:

| Surface | Use it when | Docs |
|---|---|---|
| **MCP server** | You want Claude Code, Claude Desktop, Cursor, Codex or Gemini CLI to use memory as tools | [MCP server](./mcp.md) |
| **`zekra` CLI** | You want to connect a client in one command, or use memory from the shell | [CLI](./cli.md) |
| **REST API** | You are building your own agent, service or integration | [REST API](./api.md) |

The hosted service runs at **https://app.zekra.dev**. It serves the web console, the REST
API and the MCP backend. You can also [self-host](./self-hosting.md) it.

## Core concepts

### Brains (namespaces)

A **brain** is a named namespace, such as `research` or `acme-backend`. Every memory
belongs to exactly one brain, and every read and write names the brain it targets. Access
is granted per brain. A brain exists as soon as it holds at least one memory. The console's
**New brain** button and `zekra brain create` store a first marker memory for you.

### Memories

A **memory** is a piece of text plus provenance:

- `sourceKind`: where it came from, such as `claude_code`, `chat` or `manual`
- `sourceRef`: a session, thread or run id
- `visibility`: `private` (the default), `team` or `global`
- `importance`: a score from 0 to 1 that the server computes. You can nudge it with `importanceHint`.
- `network` (`fact`, `experience`, `observation`, `belief`) and `memoryType` (`episodic`, `semantic`, `procedural`, `working`)
- `validAt` / `invalidAt`: when the memory became true, and when it stopped being true
- free-form `metadata`

Nothing is hard-deleted. *Forgetting* a memory sets `invalidAt`, and the history stays queryable.

### Retain and recall

- **Retain** writes a memory. The server embeds it, indexes it for keyword search, detects
  and vaults any secrets in it, decides whether it is new (the write decision below) and links
  it into the entity graph.
- **Recall** runs a hybrid search inside one brain. It fuses dense-vector and BM25 keyword
  results with reciprocal rank fusion, adds a salience signal, reranks the list and can expand
  one hop through the entity graph. Results come back with scores and provenance. You can
  filter by time (`since`, `until`, `asOf`) and order by `recent` or `oldest`.
- **Search** runs the same kind of query across every brain you can read.

### The write decision

On every retain, Zekra compares the new text with the most similar memory already in that brain:

| Decision | When |
|---|---|
| `noop` | The content is identical or nearly identical. Nothing new is stored. |
| `update` | Same subject, changed content. The new memory supersedes the old one (`supersededId`). |
| `invalidate` | The new content explicitly negates a very similar memory. The old one is retired. |
| `add` | Anything else. A new memory is stored. |

Callers never choose the decision. Retaining the same fact twice is safe, so agents can
retain freely.

### Knowledge graph

Zekra extracts entities and typed relations from memories. You can walk the graph
(`graph_traverse`), list the relations of one entity (`graph_neighbors`), find how two
entities connect (`graph_path`), and read the brain's declared entity and relation types
(`graph_ontology`). Recall uses the graph to pull in related memories.

### Knowledge gaps

When a recall returns nothing, Zekra records the query as a **gap**. Repeated misses are
counted. You can list gaps, add the missing knowledge, and then mark the gap `indexed` or
`dismissed`.

### Secrets vault

Each brain has an encrypted vault (AES-256-GCM). When retained text contains something that
looks like a credential, such as an API key, password, connection string or private key,
Zekra moves the value into the vault and replaces it in the memory with a `[secret:<name>]`
reference. You can also store secrets explicitly. Anyone who can read the brain can list
secret names. Revealing a value requires write access. See [Security](./security.md).

### Tokens and grants

Agents authenticate with an **access token** (`cbt_…`) sent in the `X-Zekra-Token` header.
A token maps to an agent identity. **Grants** give that identity `canRead` and/or `canWrite`
on specific brains. Admin tokens bypass grants. People sign in to the console with an
account (email and password, an emailed code, or Google, GitHub or Apple, with optional
two-factor authentication).

### Data sources

Connectors pull external content into a brain: inline text or markdown, a crawled URL, a
GitHub repository, a SQL query, or pushed webhook events. The content goes through the same
retain pipeline. See [Data sources](./data-sources.md).

### Chat

`brain_chat` / `POST /api/brain/chat` asks a brain a question. A tool-calling agent uses the
brain's own recall, search and graph tools, and answers only from what it found. It returns
citations and a trace of the tool calls it made.

## Quickstart

```sh
# 1. Install the CLI
curl -fsSL https://app.zekra.dev/install.sh | sh

# 2. Save your token (get one from the console, see the Quickstart page)
zekra auth login --token cbt_...

# 3. Wire Zekra into your client
zekra mcp:install claude-code --brain my-project
```

Restart the client. The `memory_recall`, `memory_retain` and other memory tools are now
available. The [Quickstart](./quickstart.md) walks through each step, including how to get
a token.

## Next steps

- [Quickstart](./quickstart.md): account, brain, token and a connected agent
- [MCP server](./mcp.md): every tool and client setup
- [CLI](./cli.md): `zekra` commands and the Claude Code plugin
- [REST API](./api.md): endpoints, payloads, errors and events
- [Data sources](./data-sources.md) · [Capture hook](./capture-hook.md) · [Security](./security.md) · [Self-hosting](./self-hosting.md)
