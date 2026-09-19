---
title: CLI
description: Install the zekra CLI, log in, connect MCP clients, manage brains and tokens, use hooks, and install the Claude Code plugin.
order: 4
---

# The `zekra` CLI

`zekra` is a single binary with no dependencies. It does three jobs:

1. It **is** the MCP server (`zekra mcp`), a stdio adapter over the Zekra REST API.
2. It **wires** that server into MCP clients (`zekra mcp:install <client>`).
3. It **drives** Zekra from the shell: brains, tokens, recall and retain.

Source: [github.com/fadymondy/zekra-cli](https://github.com/fadymondy/zekra-cli) (MIT).

## Install

Install script (macOS, Linux; Windows through Git Bash or WSL):

```sh
curl -fsSL https://app.zekra.dev/install.sh | sh
```

npm (Node 16 or later; downloads the native binary for your platform):

```sh
npm i -g zekra-cli
```

Go:

```sh
go install github.com/fadymondy/zekra-cli@latest
```

The install script puts `zekra` in `/usr/local/bin` if it can write there, and otherwise in
`~/.local/bin`. If it cannot download a prebuilt binary, it builds from source with
`go install`. It reads these optional variables:

| Variable | Meaning |
|---|---|
| `ZEKRA_URL` | Endpoint to log in to (default `https://app.zekra.dev`) |
| `ZEKRA_TOKEN` | If set, runs `zekra auth login` for you |
| `ZEKRA_CLIENT` | `claude-desktop`, `claude-code`, `codex`, `gemini` or `cursor`: runs `zekra mcp:install` for you |
| `ZEKRA_BIN_DIR` | Install directory |
| `ZEKRA_VERSION` | Release tag (default `latest`) |

Install, log in and connect a client in one line:

```sh
ZEKRA_TOKEN=cbt_... ZEKRA_CLIENT=claude-desktop \
  sh -c "$(curl -fsSL https://app.zekra.dev/install.sh)"
```

### Upgrade

```sh
curl -fsSL https://app.zekra.dev/upgrade.sh | sh
```

The upgrade script detects whether you installed with npm, Go or the binary installer and
updates in place. There is no `zekra upgrade` subcommand. Check your version with
`zekra version`.

## Log in

```sh
zekra auth login --token cbt_...
```

This saves the endpoint and token to `~/.zekra/config.json` and pings the server to check
that it is reachable. Get a token from the console (see [Quickstart](./quickstart.md#3-get-a-token))
or from an admin. `auth login` takes a token. It does not open a browser sign-in flow.

| Flag | Meaning |
|---|---|
| `--url URL` | Zekra endpoint (default `https://app.zekra.dev`; use your own for self-hosting) |
| `--token TOKEN` | Access token (`cbt_…`) |
| `--agent ID` | Agent label sent as `X-Agent-Id` |
| `--brain NS` | Default brain for recall, retain and the MCP session |

Configuration is resolved in this order, highest first: **flags, then environment
variables** (`ZEKRA_API_URL`, `ZEKRA_TOKEN`, `ZEKRA_AGENT_ID`, `ZEKRA_DEFAULT_NAMESPACE`),
**then `~/.zekra/config.json`**. Legacy `CABRAIN_*` names are also read.

## Command reference

Colon and space forms are the same command: `zekra mcp:install` is `zekra mcp install`.

### Auth

| Command | What it does |
|---|---|
| `zekra auth login [--url U] [--token T] [--agent ID] [--brain NS]` | Save credentials and check reachability |
| `zekra auth logout` | Remove the saved token (the endpoint is kept) |
| `zekra auth whoami` | Show the endpoint and the brains your token can reach |
| `zekra auth token new <agentId> [--admin] [--brain NS]` | Mint a token (needs an admin token), optionally granting it a brain |
| `zekra auth token list` | List tokens and their grants (admin) |

Top-level shortcuts: `zekra login`, `zekra logout`, `zekra status` (also `whoami`, `ping`) and `zekra token`.

### MCP

| Command | What it does |
|---|---|
| `zekra mcp` | Run the stdio MCP server. Clients launch this. |
| `zekra mcp:install <client> [--brain NS] [--name N] [--user]` | Add Zekra to a client's MCP config |
| `zekra mcp:print <client> [--brain NS]` | Print the config snippet without writing anything |
| `zekra mcp:uninstall <client> [--name N]` | Remove the Zekra entry from a client |

`--brain` sets `ZEKRA_DEFAULT_NAMESPACE` for the session. `--name` changes the server
entry name (default `zekra`), so you can install several entries bound to different brains.
`--user` applies to Claude Code only: it writes `~/.claude.json` instead of the project's
`.mcp.json`. `zekra install <client>` is a shortcut for `mcp:install`.

| Client | File written | Format |
|---|---|---|
| `claude-code` | `./.mcp.json`, or `~/.claude.json` with `--user` | JSON |
| `claude-desktop` | `claude_desktop_config.json` in the Claude config directory (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/`) | JSON |
| `codex` | `~/.codex/config.toml`, table `[mcp_servers.zekra]` | TOML |
| `gemini` | `~/.gemini/settings.json` | JSON |
| `cursor` | `~/.cursor/mcp.json` | JSON |
| `print` | stdout only | JSON |

Installs merge into the existing file and keep your other MCP servers. They are idempotent:
running the command again replaces only the Zekra entry. The entry points at the absolute
path of the `zekra` binary you ran, with your endpoint and token in its `env` block.

### Brains and memory

| Command | What it does |
|---|---|
| `zekra brain list` | List the brains you can read |
| `zekra brain create <name> [--description D] [--token]` | Create a brain. With `--token`, also mint a non-admin token that can read and write only this brain, and print a ready-to-share MCP snippet (needs an admin token). |
| `zekra brain delete <name> --confirm` | Delete a brain and all of its memories |
| `zekra recall <brain> <query...> [--limit N]` | Hybrid recall |
| `zekra retain <brain> <content...>` | Store a memory |

Example:

```sh
zekra brain create research --description "market and competitor notes" --token
zekra retain research "Competitor X raised prices 20% in March."
zekra recall research "competitor pricing"
```

### Hooks

`zekra hook` reads Claude Code hook JSON on stdin and prints context to inject. Hooks
**fail open**: on any error they print nothing and never block the session.

| Command | Hook event | What it does |
|---|---|---|
| `zekra hook rules` (alias `session-start`) | `SessionStart` | Injects the recall, answer, retain rules. On by default; set `ZEKRA_HOOK_RULES=0` to turn it off. |
| `zekra hook recall` (alias `user-prompt`) | `UserPromptSubmit` | Recalls the top memories for each prompt from your default brain and injects them. Opt-in: set `ZEKRA_HOOK_AUTORECALL=1` and a brain in `ZEKRA_AUTORECALL_BRAIN` (or `ZEKRA_DEFAULT_NAMESPACE`, or the saved config). |

To use the hooks without the plugin, add them to your Claude Code `settings.json`:

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "zekra hook rules" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "zekra hook recall" }] }]
  }
}
```

Writing to the brain stays model-driven on purpose, so that stored memories are selective
and distilled. For automatic capture of turns, see the [capture hook](./capture-hook.md).

### Other

| Command | What it does |
|---|---|
| `zekra version` | Print the version |
| `zekra help` | Print usage |

## Claude Code plugin

The CLI repository is also a Claude Code plugin. It bundles the MCP server, slash commands,
two agents, a skill and the hooks above.

```text
/plugin marketplace add fadymondy/zekra-cli
/plugin install zekra@zekra
```

The plugin needs the `zekra` binary on your `PATH`, because its MCP server runs `zekra mcp`.
When you enable it, Claude Code asks for these settings:

| Option | Meaning |
|---|---|
| `api_token` (required) | Your Zekra token |
| `api_url` | Endpoint (default `https://app.zekra.dev`) |
| `default_namespace` | Bind the session to one brain |
| `auto_recall` | Turn on the auto-recall hook (default off) |
| `inject_rules` | Inject the memory-first rules at session start (default on) |

What it adds:

| Kind | Name | What it does |
|---|---|---|
| command | `/zekra:recall [brain] <query>` | Recall and answer from memory |
| command | `/zekra:retain [brain] <content>` | Store a memory |
| command | `/zekra:brains [name]` | List brains, or show one brain's details |
| command | `/zekra:new-brain <name>` | Create a brain |
| command | `/zekra:connect [client]` | Wire the MCP server into another client |
| command | `/zekra:status` | Endpoint and reachable brains |
| command | `/zekra:doctor` | Check that the CLI is installed and current, you are logged in, and the MCP server responds |
| agent | `zekra-curator` | Memory-first Q&A: recall, answer, retain |
| agent | `zekra-connector` | Setup: install, tokens, brains, data sources |
| skill | `memory-first` | The recall, answer or act, retain routine |
| hook | `SessionStart` | Runs `zekra hook rules` |
| hook | `UserPromptSubmit` | Runs `zekra hook recall` (opt-in) |

There is no `zekra doctor` shell command. Diagnostics are the `/zekra:doctor` slash command.
