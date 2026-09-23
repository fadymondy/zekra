// The renderer's Content-Security-Policy, in ONE place.
//
// build/bundle.mjs writes it into out/renderer/index.html's <meta> tag (the
// source index.html carries a %CSP% placeholder), and src/main/security.ts
// sends the same string as a response header for anything the renderer's
// session loads over http(s). Keep them from drifting by editing only this.
//
// Why each non-'self' source is here:
//   img-src blob:   object URLs from useAuthedImage (authed API images are
//                   fetched by main and handed over as bytes).
//   img-src data:   inline images in notes / exported HTML.
//   img-src https:  public images embedded in notes.
//   connect-src     inside Electron the renderer does NOT talk to the API
//                   (main proxies it, see api-proxy.ts); blob:/data: cover
//                   fetch() of object URLs the editor makes for pasted
//                   images. https:/localhost keep the browser preview (which
//                   has no main process and fetches directly) working.
//   style 'unsafe-inline'  Tailwind/shadcn and TipTap write style attributes.
export const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'", "data:"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": ["'self'", "blob:", "data:", "https:", "http://localhost:*", "http://127.0.0.1:*"],
  "worker-src": ["'self'", "blob:"],
  "frame-src": ["https:"],
  "object-src": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
};

export const CSP = Object.entries(CSP_DIRECTIVES)
  .map(([k, v]) => `${k} ${v.join(" ")}`)
  .join("; ");
