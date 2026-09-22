// Backend calls, made from the MAIN process (MH-269).
//
// The renderer loads from file://, so every request it makes carries
// `Origin: null`. The API rejects that — deliberately: these routes carry the
// session cookie, and `Origin: null` is also what any sandboxed iframe and any
// local file sends, so allow-listing it would let arbitrary pages act as the
// signed-in user. There is a test pinning that rejection
// (TestCORSRejectsUnlistedOrigins). A packaged build could therefore reach
// nothing; only the tunnelled preview worked, because it has a real origin.
//
// Electron's `net` module is not a browser fetch: it runs in the main process,
// where the same-origin policy and CORS simply do not apply. So the fix is to
// move the network out of the renderer rather than to weaken the server.
//
// The custom-protocol alternative (app://) was tried on another Electron app
// and recorded on MH-269: Chromium silently refuses to execute
// `<script type="module">` from a custom scheme. Our renderer happens to be an
// IIFE already, so it would have survived that — but proxying is still the
// better posture, because the session token stops being reachable from
// renderer JS at all.
"use strict";

import { net } from "electron";

/** What the renderer asks for. Bodies are strings or one multipart file. */
export interface ProxyRequest {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  /** JSON (or any text) body. */
  body?: string;
  /** An image upload. Mutually exclusive with `body`. */
  file?: { field: string; filename: string; contentType: string; bytes: Uint8Array; fields: Record<string, string> };
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Multipart bodies are assembled here; the renderer cannot send a FormData
 *  across IPC (File/Blob are not structured-cloneable in this direction). */
function multipart(file: NonNullable<ProxyRequest["file"]>): { body: Buffer; contentType: string } {
  const boundary = `----zekra${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(file.fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; ` +
        // Quotes in a filename would break the header; strip rather than escape,
        // since the server ignores the name anyway.
        `filename="${file.filename.replace(/["\r\n]/g, "")}"\r\n` +
        `Content-Type: ${file.contentType || "application/octet-stream"}\r\n\r\n`,
    ),
    Buffer.from(file.bytes),
    Buffer.from("\r\n"),
  );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Perform one request. Never throws for an HTTP status — a 4xx/5xx comes back
 * as a normal ProxyResponse so the renderer's error handling is unchanged.
 * A transport failure rejects, and surfaces there as status 0.
 */
export function proxyRequest(req: ProxyRequest): Promise<ProxyResponse> {
  // Only ever talk to the configured API base; a path is a path, not a URL.
  const base = new URL(req.baseUrl);
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
    return Promise.reject(new Error("refusing a non-HTTPS API base"));
  }
  const url = new URL(req.path, base);
  if (url.origin !== base.origin) return Promise.reject(new Error("refusing a cross-origin path"));

  return new Promise((resolve, reject) => {
    const request = net.request({
      method: req.method,
      url: url.toString(),
      // Keep using the session's cookie jar, so the CSRF pair the brain's
      // write guard wants still works exactly as it did from the renderer.
      useSessionCookies: true,
    });

    for (const [k, v] of Object.entries(req.headers)) request.setHeader(k, v);

    let payload: Buffer | undefined;
    if (req.file) {
      const { body, contentType } = multipart(req.file);
      payload = body;
      request.setHeader("Content-Type", contentType);
    } else if (req.body !== undefined) {
      payload = Buffer.from(req.body, "utf8");
    }

    request.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
        resolve({ status: res.statusCode, headers, body: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("error", reject);
    });
    request.on("error", reject);

    if (payload) request.write(payload);
    request.end();
  });
}
