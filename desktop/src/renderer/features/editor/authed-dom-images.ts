import { useEffect, type RefObject } from "react";

import { ACCEPTED_IMAGE_TYPES, ImageUploadError, MAX_IMAGE_BYTES } from "@/lib/notes/upload-image";

import { zekraApi } from "../../lib/api";
import { isApiImage, loadAuthedImage } from "../../lib/authed-image";

/*
Note images inside rendered HTML (the preview pane, the TipTap editor).

Uploaded note images are referenced by relative API paths
(`/api/notes/image/<ns>/<digest>`). In the web console the browser resolves
those against its own origin and sends the session cookie. The desktop page is
file://, so the path resolves to a file that does not exist, and even an
absolute URL could not carry the bearer token.

So a MutationObserver watches the container and swaps every API image's src
for an object URL of the bytes fetched through the main process
(lib/authed-image.ts). The original path is kept in data-zk-src.

Safe inside ProseMirror: an image is a leaf node, and ProseMirror ignores DOM
mutations on leaf views — the document (and therefore the saved markdown)
keeps the original path. When ProseMirror re-renders the node, the new <img>
is swapped again.
*/

const ORIGINAL = "data-zk-src";
const objectUrls = new Map<string, string>();

async function urlFor(src: string): Promise<string | null> {
  const hit = objectUrls.get(src);
  if (hit) return hit;
  const blob = await loadAuthedImage(src);
  if (!blob) return null;
  // One object URL per source for the whole session: images are
  // content-addressed, and loadAuthedImage bounds the bytes behind them.
  const url = URL.createObjectURL(blob);
  objectUrls.set(src, url);
  return url;
}

function swap(img: HTMLImageElement) {
  const src = img.getAttribute("src");
  if (!src || src.startsWith("blob:") || src.startsWith("data:")) return;
  if (!isApiImage(src)) return;
  if (img.getAttribute(ORIGINAL) === src) return;
  img.setAttribute(ORIGINAL, src);
  // Blank until the bytes arrive, instead of a broken-image glyph.
  img.style.minHeight = img.style.minHeight || "1px";
  void urlFor(src).then((url) => {
    if (url && img.getAttribute(ORIGINAL) === src) img.setAttribute("src", url);
  });
}

function scan(root: ParentNode) {
  root.querySelectorAll?.("img").forEach((img) => swap(img as HTMLImageElement));
}

/** Keep every API image under `ref` loadable. `dep` re-scans after a re-render. */
export function useAuthedImagesIn(ref: RefObject<HTMLElement | null>, dep?: unknown): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    scan(el);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes" && r.target instanceof HTMLImageElement) swap(r.target);
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLImageElement) swap(n);
          else if (n instanceof HTMLElement) scan(n);
        });
      }
    });
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    return () => mo.disconnect();
  }, [ref, dep]);
}

/** The editor's image uploader: multipart through the main-process proxy,
 *  validated like web/lib/notes/upload-image.ts. */
export async function uploadNoteImage(token: string, file: File | Blob, namespace: string): Promise<{ url: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageUploadError(`Image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
  }
  if (file.type && !ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new ImageUploadError(
      file.type === "image/svg+xml" ? "SVG images are not accepted" : `Unsupported image type: ${file.type}`,
    );
  }
  try {
    return await zekraApi.uploadImage(token, file, namespace);
  } catch (e) {
    // The editor shows ImageUploadError messages verbatim, anything else as a
    // generic failure — keep the server's reason.
    throw new ImageUploadError(e instanceof Error ? e.message : "Image upload failed");
  }
}
