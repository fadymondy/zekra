import { useEffect, useState } from "react";

import { bridge } from "./bridge";

/*
Authenticated images for the renderer (MH-450).

The API's image routes (brain avatars, note images) are members-only and want
the bearer token. An <img src> cannot send it, and a file:// page's own fetch()
is rejected by the API's origin check (Origin: null, MH-269). So the bytes are
fetched by the MAIN process — which attaches the stored token itself
(window.zekra.apiBinary -> src/main/api-proxy.ts proxyBinary) — and turned into
an object URL here. The CSP allows blob: for img-src for exactly this.

Mirrors mobile/src/features/editor/image-cache.ts:
  - in-memory cache keyed by the ORIGINAL src, bounded by total bytes, LRU;
    uploaded images are content-addressed so an entry never goes stale
  - in-flight de-duplication, so ten avatars of one brain make one request
  - anything that is not an API path is answered with itself (public https
    images, data:, blob:)

Each hook instance mints its own object URL from the cached Blob and revokes it
on unmount, so there is no shared URL whose lifetime has to be ref-counted.
*/

const MAX_BYTES = 48 * 1024 * 1024;
const cache = new Map<string, Blob>();
let total = 0;
const inflight = new Map<string, Promise<Blob | null>>();

/** Is `src` something we must fetch through the authed proxy? */
export function isApiImage(src: string): boolean {
  // Relative API paths ("/api/…") always are. Absolute URLs are checked by
  // main against the configured API origin; here we route any absolute URL
  // whose path is under /api/ through it and let main refuse other origins.
  if (src.startsWith("/api/")) return true;
  try {
    const u = new URL(src);
    return (u.protocol === "https:" || u.protocol === "http:") && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function remember(src: string, blob: Blob) {
  if (blob.size > MAX_BYTES / 4) return; // one huge image must not evict everything
  cache.set(src, blob);
  total += blob.size;
  for (const [key, value] of cache) {
    if (total <= MAX_BYTES) break;
    cache.delete(key);
    total -= value.size;
  }
}

/** Fetch (or reuse) the bytes for an API image. null = not loadable. */
export function loadAuthedImage(src: string): Promise<Blob | null> {
  const hit = cache.get(src);
  if (hit) {
    cache.delete(src); // refresh recency
    cache.set(src, hit);
    return Promise.resolve(hit);
  }
  const running = inflight.get(src);
  if (running) return running;
  const job = (async () => {
    try {
      const res = await bridge().apiBinary(src);
      if (!res.ok || !res.bytes) return null;
      let type = res.contentType.split(";")[0].trim();
      if (!type.startsWith("image/")) {
        // A server that labels the bytes octet-stream: name the type from the
        // (content-addressed) path so <img> can decode it.
        const ext = /\.(png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i.exec(src)?.[1]?.toLowerCase();
        type = ext ? `image/${ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : ext}` : "image/png";
      }
      const blob = new Blob([res.bytes as BlobPart], { type });
      remember(src, blob);
      return blob;
    } catch {
      return null;
    } finally {
      inflight.delete(src);
    }
  })();
  inflight.set(src, job);
  return job;
}

/** Drop everything (e.g. on sign-out, so another account never sees them). */
export function clearAuthedImageCache(): void {
  cache.clear();
  total = 0;
}

/**
 * An <img>-ready URL for `src`: an object URL for API images, `src` itself for
 * public/data/blob URLs, or null while loading / when it cannot be loaded.
 * `src` may be null/undefined (renders the caller's fallback).
 */
export function useAuthedImage(src: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (src && !isApiImage(src) ? src : null));

  useEffect(() => {
    if (!src) {
      setUrl(null);
      return;
    }
    if (!isApiImage(src)) {
      setUrl(src);
      return;
    }
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    void loadAuthedImage(src).then((blob) => {
      if (!alive || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return url;
}
