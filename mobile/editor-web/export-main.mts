import { toPng } from "html-to-image";

import { markdownToDocx } from "../../web/lib/notes/export/docx.ts";
import { noteToHtml } from "../../web/lib/notes/export/html.ts";
import { markdownToTxt } from "../../web/lib/notes/export/txt.ts";
import type { ToEngine } from "../src/features/editor/bridge-core.ts";
import { pngPixelRatio } from "../src/features/editor/export-core.ts";
import { errorText, listen, post } from "./bridge.mts";
import { imageFailed, imageResolved, imagesSettled, isDirect, resolveImage } from "./images.mts";
import { applyLineNumbers, renderFragment, setReaderLabels } from "./reader.mts";
import { CSS } from "./styles.mts";
import { applyDir, applyTheme, applyTypography } from "./theme.mts";

/*
The export page, mounted hidden by <ExportHost/> (src/features/editor/
export-host.tsx). It runs web's exporters verbatim — they are browser code
(docx, html-to-image, DOMPurify need a DOM) — and hands the file back over
the bridge as text or base64:

  html  web noteToHtml (self-contained, themed), with note images inlined as
        data: URLs so the file still shows them outside the app
  txt   web markdownToTxt
  docx  web markdownToDocx (its Packer.toBuffer is shimmed to base64)
  png   the note rendered with the current reading theme, captured with
        html-to-image
PDF is printed by RN (expo-print) from the html result, and md needs no page.
*/

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);
document.documentElement.setAttribute("data-purpose", "export");

async function inlineImages(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imgs = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src || isDirect(src)) return;
      const url = await resolveImage(src);
      if (url && url.startsWith("data:")) img.setAttribute("src", url);
    }),
  );
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

async function capturePng(markdown: string, title: string): Promise<string> {
  const surface = document.createElement("div");
  surface.id = "zk-capture";
  surface.className = "zk-prose zk-reader";
  if (title.trim()) {
    const h = document.createElement("div");
    h.className = "zk-export-title";
    h.dir = "auto";
    h.textContent = title;
    surface.appendChild(h);
  }
  const body = document.createElement("article");
  body.appendChild(renderFragment(markdown));
  surface.appendChild(body);
  // Interactive chrome means nothing in a picture.
  surface.querySelectorAll(".zk-code-menu,.zk-table-menu,.zk-table-filter").forEach((el) => el.remove());
  document.body.appendChild(surface);
  try {
    applyLineNumbers(surface, document.documentElement.getAttribute("data-lines") === "on");
    await Promise.all(
      Array.from(surface.querySelectorAll<HTMLImageElement>("img[data-zk-src]")).map(async (img) => {
        const url = await resolveImage(img.dataset.zkSrc ?? "");
        if (url) img.src = url;
        else img.remove();
      }),
    );
    await imagesSettled(surface);
    if (document.fonts?.ready) await document.fonts.ready;
    const rect = surface.getBoundingClientRect();
    const dataUrl = await toPng(surface, {
      pixelRatio: pngPixelRatio(rect.width, rect.height),
      backgroundColor: getComputedStyle(surface).backgroundColor,
      cacheBust: false,
    });
    return dataUrl.slice(dataUrl.indexOf(",") + 1);
  } finally {
    surface.remove();
  }
}

async function run(msg: Extract<ToEngine, { type: "export" }>): Promise<void> {
  try {
    switch (msg.format) {
      case "html": {
        const html = noteToHtml(msg.markdown, { title: msg.title, theme: msg.themeId, dir: msg.dir });
        post({ type: "exportResult", id: msg.id, ok: true, data: await inlineImages(html), encoding: "utf8" });
        break;
      }
      case "txt":
        post({ type: "exportResult", id: msg.id, ok: true, data: markdownToTxt(msg.markdown), encoding: "utf8" });
        break;
      case "docx": {
        // The shim makes this a base64 string (see docx-shim.mts).
        const data = (await markdownToDocx(msg.markdown)) as unknown as string;
        post({ type: "exportResult", id: msg.id, ok: true, data, encoding: "base64" });
        break;
      }
      case "png":
        post({ type: "exportResult", id: msg.id, ok: true, data: await capturePng(msg.markdown, msg.title), encoding: "base64" });
        break;
      default:
        post({ type: "exportResult", id: msg.id, ok: false, error: `unsupported format ${String((msg as { format?: string }).format)}` });
    }
  } catch (e) {
    post({ type: "exportResult", id: msg.id, ok: false, error: errorText(e) });
  }
}

listen((msg) => {
  switch (msg.type) {
    case "init":
      setReaderLabels({ rows: msg.strings.rows, filter: msg.strings.filter });
      applyTheme(msg.theme);
      applyTypography(msg.typography);
      applyDir(msg.dir);
      break;
    case "setTheme":
      applyTheme(msg.theme);
      break;
    case "setTypography":
      applyTypography(msg.typography);
      break;
    case "imageResolved":
      imageResolved(msg.src, msg.url);
      break;
    case "imageFailed":
      imageFailed(msg.src);
      break;
    case "export":
      return run(msg);
    default:
      break;
  }
});

post({ type: "ready" });
