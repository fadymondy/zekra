# Save to Zekra (Chrome extension)

A Manifest V3 capture tool: save the current page (title + URL + selection) as a
note in a Zekra brain, from a popup, a right-click context menu, or `Ctrl+Shift+Z`.

## Auth contract

This extension authenticates like `cmd/zekra-mcp` (see
`plugins/brain/mcptools/http_backend.go`), **not** like the Next.js web console
(`web/lib/api.ts`), because a browser extension is a separate origin and can't
reuse the console's `togo_session` cookie + CSRF token. Every request sends:

- `X-Zekra-Token: <token>` — the ACL token credential, checked first in
  `plugins/brain/internal/brain/caller.go` `resolveCaller()` via `TokenHeader()`
  (`plugins/brain/internal/brain/envcompat.go`).
- `X-Agent-Id: <label>` — a non-credential activity label (defaults to
  `extension`), same as `HTTPBackend.Agent` in `http_backend.go`.

Get a token from the console's brain token UI, or `POST /api/brain/tokens`
(admin-only; see `plugins/brain/internal/brain/handlers.go:569`), or the
`brain_create_token` MCP tool. Paste it into the popup or the options page —
it's stored only in `chrome.storage.local` (never injected into page contexts,
never sent anywhere but the configured API base).

## Endpoints

- `GET /api/brain/mine` — lists brains (namespaces) the token can reach, for the
  popup's brain picker (`plugins/brain/internal/brain/notes_handlers.go:410`).
- `POST /api/notes` — creates the note
  (`plugins/brain/internal/brain/notes_handlers.go:217`), body
  `{namespace, title, body, tags, pinned, source}`. `source` must be one of
  `web|mobile|desktop|agent|api` (`plugins/brain/internal/brain/notes.go:46`) —
  there's no `"extension"` value, so this client sends `"api"`.

## Load unpacked (Chrome/Edge)

1. Visit `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Click the toolbar icon, paste a Zekra API token, pick a brain, and save a note.
4. Optional: open the extension's **Options** page to change the API base URL
   (default `https://app.zekra.dev`) — a non-default base prompts an
   `optional_host_permissions` grant at save time.

## Known gaps / open questions

- Icons are solid-color placeholders (generated, not designed) — swap
  `icons/icon{16,48,128}.png` for real artwork.
- No i18n; English only, per the task's v1 scope.
- The background service worker's context-menu/shortcut quick-capture needs a
  default brain saved first (from the popup) — until then it opens the popup so
  the user can pick one, rather than guessing a namespace.
- Token minting/rotation UI is intentionally out of scope here — this extension
  only *consumes* a token created elsewhere (console/admin/MCP tool).
