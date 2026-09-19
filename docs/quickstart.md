---
title: Quickstart
description: Create an account, create a brain, get a token and connect your first agent to Zekra.
order: 2
---

# Quickstart

This guide takes you from nothing to an agent that remembers across sessions. It uses the
hosted service at **https://app.zekra.dev**. On a self-hosted instance, use your own URL
wherever `app.zekra.dev` appears.

## 1. Create an account

Open **https://app.zekra.dev/register** and sign up with email and password, or with
Google, GitHub or Apple if they are offered. Confirm your email with the code Zekra sends
you. You can turn on two-factor authentication later under **Account → Security**.

## 2. Create a brain

In the console, open **Brains** and click **New brain**. Give it a name such as
`my-project`. The name becomes the brain's namespace, and it is the value you pass as
`namespace` everywhere else.

A brain exists once it holds at least one memory. **New brain** stores a first marker memory
for you, so agents can connect right away.

## 3. Get a token

Agents authenticate with an access token (`cbt_…`). The simplest way to get one is a
**session token** scoped to one brain:

1. Open the brain, then its **Sessions** tab.
2. Choose whether the session may write (leave it off for read-only), then click **Launch a session**.
3. Copy the token. The console also shows a ready-made MCP config.

A session token is bound to a new agent identity (`session-<brain>-<random>`) that has a
grant on this brain only.

Admins can also mint tokens under **Admin → Tokens** and grant them any brains. The same
actions are available through the API (`POST /api/brain/tokens`, `POST /api/brain/grant`)
and the CLI (`zekra auth token new`).

> Treat a token like a password. Anyone who has it can read, and possibly write, the brains
> it is granted.

## 4. Install the CLI and log in

```sh
curl -fsSL https://app.zekra.dev/install.sh | sh
zekra auth login --token cbt_...
```

`auth login` saves the endpoint and token to `~/.zekra/config.json` and checks that the
server is reachable. Other ways to install (npm, `go install`) are listed in [CLI](./cli.md).

## 5. Connect your agent

```sh
zekra mcp:install claude-code --brain my-project
```

Swap in `claude-desktop`, `cursor`, `codex` or `gemini` for other clients. `--brain`
makes `my-project` the default namespace, so tools that take a `namespace` argument can
omit it. The installer merges a `zekra` entry into the client's MCP config and leaves your
other servers alone.

Restart the client.

## 6. Try it

Ask your agent:

> Remember that our staging database is Postgres 16 and deploys go out from the `release` branch.

The agent calls `memory_retain`. In a new session, ask:

> Which branch do we deploy from?

The agent calls `memory_recall` and answers from the stored memory. You can check the same
thing from the shell:

```sh
zekra recall my-project "deploy branch"
```

Or with curl:

```sh
curl -sS https://app.zekra.dev/api/brain/recall \
  -H "X-Zekra-Token: $ZEKRA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"namespace":"my-project","query":"deploy branch"}'
```

## Make memory a habit

Agents use memory reliably when they are told to recall first, answer from what they find,
and retain what is new. The [Claude Code plugin](./cli.md#claude-code-plugin) adds this rule
automatically at the start of every session. For other clients, add a line like this to the
agent's instructions (`CLAUDE.md`, `AGENTS.md`, Cursor rules and so on):

```text
Before answering questions about this project, call memory_recall (namespace "my-project").
Answer from what it returns and say so if it returns nothing. After you make a decision or
learn a durable fact, call memory_retain with a short, distilled sentence.
```

## Next

- [MCP server](./mcp.md): every tool and its arguments
- [Data sources](./data-sources.md): load documents, repositories and databases into a brain
- [Security](./security.md): tokens, grants and the secrets vault
