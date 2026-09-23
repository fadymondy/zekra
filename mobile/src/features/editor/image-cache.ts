import { API_URL } from "@/lib/api";

import { authImageUrl } from "./engine-core";

/*
RN half of note-image loading (see editor-web/images.mts for why the page
never gets the token).

For an API image: fetch with the bearer, read the blob as a data: URL, hand it
to the page. Anything else is answered with its own URL so the page loads it
directly (public https images) — the token only ever goes to API_URL
(engine-core authImageUrl pins the origin).

Kept in memory, bounded by total size, shared by every engine on screen and
the export host, and keyed by the ORIGINAL src so the markdown is never
involved. Uploaded images are content-addressed (sha in the path), so a cached
entry can never go stale.
*/

const MAX_CHARS = 48 * 1024 * 1024; // ~36 MB of image bytes as base64
const cache = new Map<string, string>();
let total = 0;
const inflight = new Map<string, Promise<string | null>>();

function remember(src: string, dataUrl: string) {
  if (dataUrl.length > MAX_CHARS / 4) return; // one huge image must not evict everything
  cache.set(src, dataUrl);
  total += dataUrl.length;
  for (const [key, value] of cache) {
    if (total <= MAX_CHARS) break;
    cache.delete(key);
    total -= value.length;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read image"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The URL the page should show for `src`: a data: URL for an API image, the
 * src itself for a public http(s) image, or null if it cannot be loaded.
 */
export function resolveNoteImage(src: string, token: string | null): Promise<string | null> {
  const url = authImageUrl(src, API_URL);
  if (!url) return Promise.resolve(/^https?:\/\//i.test(src) ? src : null);
  const hit = cache.get(src);
  if (hit) {
    // Refresh recency.
    cache.delete(src);
    cache.set(src, hit);
    return Promise.resolve(hit);
  }
  const running = inflight.get(src);
  if (running) return running;
  const job = (async () => {
    try {
      const response = await fetch(url, {
        headers: { Accept: "image/*", "X-Agent-Id": "zekra-mobile", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!response.ok) return null;
      let dataUrl = await blobToDataUrl(await response.blob());
      if (!dataUrl.startsWith("data:image/")) {
        // A server/proxy that labels the bytes octet-stream: name the type
        // from the (content-addressed) path so the page can decode it.
        const ext = /\.(png|jpe?g|gif|webp|heic|avif)(?:$|[?#])/i.exec(src)?.[1]?.toLowerCase();
        if (!ext || !dataUrl.startsWith("data:")) return null;
        dataUrl = `data:image/${ext === "jpg" ? "jpeg" : ext}${dataUrl.slice(dataUrl.indexOf(";"))}`;
      }
      remember(src, dataUrl);
      return dataUrl;
    } catch {
      return null;
    } finally {
      inflight.delete(src);
    }
  })();
  inflight.set(src, job);
  return job;
}
