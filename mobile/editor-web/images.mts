import { post } from "./bridge.mts";

/*
Note images, resolved through React Native.

Uploaded note images are served at /api/notes/image/{ns}/{sha}.ext behind the
caller's session, so a plain <img src> cannot load them. The page never gets
the bearer token: it asks RN for each image (imageRequest), RN checks the URL
is on the API origin (engine-core authImageUrl), fetches it with the token and
answers with a data: URL (or, for a public image, the URL to load directly).

The markdown keeps the ORIGINAL src throughout — the resolved URL is only
ever put on a DOM <img>, never into the document model or the reader's
source — so what is saved is always the relative path the server issued.

Why not hand the token to the page and fetch here: the page renders
user-authored content, and although it is sanitised (DOMPurify / the TipTap
schema), keeping the credential out of the one context that renders
untrusted HTML is the stronger guarantee for little cost.
*/

const resolved = new Map<string, string | null>();
const waiting = new Map<string, ((url: string | null) => void)[]>();

const TIMEOUT_MS = 20_000;

/** Sources the page can load without help. */
export function isDirect(src: string): boolean {
  return /^(data|blob):/i.test(src);
}

export function resolveImage(src: string): Promise<string | null> {
  if (!src) return Promise.resolve(null);
  if (isDirect(src)) return Promise.resolve(src);
  if (resolved.has(src)) return Promise.resolve(resolved.get(src) ?? null);
  return new Promise((resolve) => {
    const list = waiting.get(src);
    if (list) {
      list.push(resolve);
      return;
    }
    waiting.set(src, [resolve]);
    post({ type: "imageRequest", src });
    setTimeout(() => settle(src, null, false), TIMEOUT_MS);
  });
}

function settle(src: string, url: string | null, remember: boolean): void {
  const list = waiting.get(src);
  if (!list) return;
  waiting.delete(src);
  if (remember) resolved.set(src, url);
  for (const fn of list) fn(url);
}

export function imageResolved(src: string, url: string): void {
  settle(src, url, true);
}

export function imageFailed(src: string): void {
  // Not remembered: a failure is often transient (offline), so the next
  // render asks again.
  settle(src, null, false);
}

/** Point a DOM <img> at `src`, going through the resolver. */
export function loadInto(img: HTMLImageElement, src: string): Promise<void> {
  img.dataset.zkSrc = src;
  img.classList.add("zk-img-pending");
  img.classList.remove("zk-img-failed");
  return resolveImage(src).then((url) => {
    // The node may have been re-pointed while this was in flight.
    if (img.dataset.zkSrc !== src) return;
    img.classList.remove("zk-img-pending");
    if (url) img.src = url;
    else img.classList.add("zk-img-failed");
  });
}

/** Resolve every <img> under `root` whose real source is on data-zk-src. */
export function hydrateImages(root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-zk-src]"));
  return Promise.all(imgs.map((img) => loadInto(img, img.dataset.zkSrc ?? ""))).then(() => undefined);
}

/** Wait until every image under `root` has loaded or failed (for capture). */
export function imagesSettled(root: ParentNode): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  return Promise.all(
    imgs.map((img) =>
      img.complete || !img.getAttribute("src")
        ? Promise.resolve()
        : new Promise<void>((done) => {
            img.addEventListener("load", () => done(), { once: true });
            img.addEventListener("error", () => done(), { once: true });
          }),
    ),
  ).then(() => undefined);
}
