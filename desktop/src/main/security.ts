// Session-level hardening for the renderer.
//
//  - CSP response header identical to the <meta> in index.html (both come
//    from src/shared/csp.ts). file:// loads carry the meta tag; the header
//    covers anything the default session fetches over http(s).
//  - Permission requests are denied except the few a notes app needs.
//  - Navigation / new windows are locked to the bundled renderer (main.ts).
"use strict";

import { session } from "electron";

import { CSP } from "../shared/csp";

const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "clipboard-read", "fullscreen", "notifications"]);

export function hardenSession(): void {
  const ses = session.defaultSession;

  ses.webRequest.onHeadersReceived((details, callback) => {
    // Only the renderer document's own responses get the policy; API calls go
    // through net.request in main and never reach here as documents.
    if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") {
      callback({});
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [CSP],
      },
    });
  });

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
}
