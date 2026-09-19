---
title: Capture hook
description: An opt-in Claude Code Stop hook that retains durable decisions and facts from each assistant turn, with private-span and secret redaction.
order: 7
---

# Capture hook

The capture hook fills a brain automatically while you work. It is a Claude Code **`Stop`**
hook: at the end of each assistant turn it reads the turn, keeps it only if it states
something durable, redacts it, and sends it to `POST /api/brain/retain`.

It lives in the Zekra server repository at `.claude/hooks/capture-mode.py`. It needs Python 3
and no extra packages.

> **Limitation:** the hook does not send an access token yet. It sends only `X-Agent-Id`,
> so it works only against a self-hosted instance that accepts requests without a token
> (see [Security](./security.md#enforcement-switches)). It does not work against
> app.zekra.dev. With a token-based setup, use the `zekra` [hooks](./cli.md#hooks) and let
> the model retain through MCP.

## What it captures

The hook keeps a turn only if it looks like a conclusion, not chatter:

- It must be at least 40 characters long.
- It must contain a decision or fact marker, such as *decided*, *chose*, *because*,
  *instead of*, *rather than*, *turns out*, *the root cause*, *should use* or *should not*,
  *constraint*, *gotcha*, *note that*, *important*, *prefer*, *corrected*, *endpoint*,
  *schema*, *contract* or *convention*.

Routine turns, such as file listings, status updates and acknowledgements, are skipped. The
server's write decision then drops anything already known.

## Privacy

- Any `<private>…</private>` span is removed **before** the request is sent. If nothing is
  left, the turn is dropped.
- If a turn contains something shaped like a credential (an AWS access key, a private-key
  block, or `password=`, `secret:`, `token=` or `api_key=` followed by a value), the
  **whole turn** is dropped.
- The server also moves any secrets it detects into the brain's [vault](./security.md#secrets-vault).

## Enable it

Capture is opt-in and does nothing unless `ZEKRA_CAPTURE=1`. Add the hook to
`.claude/settings.json` in your project, or to `~/.claude/settings.json` for all projects:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command",
        "command": "python3 /path/to/zekra/.claude/hooks/capture-mode.py" } ] }
    ]
  },
  "env": {
    "ZEKRA_CAPTURE": "1",
    "ZEKRA_API_URL": "http://localhost:8080",
    "ZEKRA_NAMESPACE": "my-project",
    "ZEKRA_AGENT_ID": "claude-code"
  }
}
```

| Variable | Default | Meaning |
|---|---|---|
| `ZEKRA_CAPTURE` | off | Must be `1` to capture anything |
| `ZEKRA_API_URL` | `http://localhost:8080` | Your Zekra instance |
| `ZEKRA_NAMESPACE` | lower-cased name of the working directory | Brain to write to |
| `ZEKRA_AGENT_ID` | none | Sent as `X-Agent-Id` |

Each captured memory is stored with `sourceKind: "claude_code"` and `sourceRef` set to the
Claude Code session id, so you can trace a memory back to the session it came from.

## Behavior

- **Never blocks.** The request times out after 2 seconds, and any failure (server down,
  turn not worth keeping, everything private) exits silently with status 0.
- **Importance is computed on the server.** The hook only decides whether a turn is worth
  sending.
