# Save to Zekra (Chrome extension)

A Manifest V3 capture tool: save the current page (title + URL + selection) as a
memory in a Zekra brain, or add a secret to a brain's vault — from the popup, a
right-click context menu, or `Ctrl+Shift+Z` / `Cmd+Shift+Z`.

No content scripts: nothing runs on the pages you visit. The selection is read
on demand (`activeTab` + `scripting`) only when you open the popup or use the
shortcut.

## Auth

OAuth 2.1 against Zekra's own authorization server
(`plugins/brain/internal/brain/oauth.go`): dynamic client registration (public
client, no secret), authorization code + PKCE (S256) through
`chrome.identity.launchWebAuthFlow`, rotating refresh tokens. Discovery is
`<apiBase>/.well-known/oauth-authorization-server`; on production the issuer
(register/token/revoke) is `https://mcp.zekra.dev`, which is why that host is in
`host_permissions`.

- Sign-in runs in the **service worker** (`background.js`): the popup closes as
  soon as the sign-in window takes focus, so it cannot finish the code exchange
  itself. Reopen the popup when you are done (on Chrome 127+ the worker also tries to reopen it).
- Refresh is single-flight across the popup, options page and worker (Web
  Locks): the server revokes the whole connection if a refresh token is used
  twice.
- A dead session (refresh rejected, or 401 after one refresh) clears the local
  token and shows **Connect** again — no retry loops.
- All requests use `credentials: "omit"` and a timeout.

## Endpoints

Everything goes through the MCP endpoint `POST <apiBase>/api/mcp`
(`tools/call`), because the OAuth principal is only attached there:

- `brain_list` — brains this connection can reach (popup picker; cached locally).
- `memory_retain` — the note (`source_kind: "extension"`, `source_ref: <page URL>`).
- `secret_store` — the vault add.

## Build

```sh
cd extension
npm run build        # node scripts/build.mjs — no dependencies
```

Outputs `dist/zekra-extension-<version>/` (load unpacked) and
`dist/zekra-extension-<version>.zip` (Chrome Web Store upload). The build drops
the web-preview shim (`browser-shim.js`, `index.html`) and checks that every
referenced file is present.

## Load unpacked (Chrome/Edge)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select `extension/dist/zekra-extension-<version>/`
   (or the `extension/` folder itself while developing).
   Updating an existing install: click the reload icon on the extension card.
3. Click the toolbar icon → **Connect Zekra account**, approve the brains in
   the Zekra window, reopen the popup, pick a brain, save.
4. Options: API base URL (default `https://app.zekra.dev`; a different host asks
   for an `optional_host_permissions` grant), agent label, the access token, and
   Disconnect.

## Web preview

`index.html` + `browser-shim.js` let the popup/options UI render in a plain
browser tab (served over HTTP) for visual checks. Chrome-only parts (active tab,
sign-in, the worker) are stubbed there.
