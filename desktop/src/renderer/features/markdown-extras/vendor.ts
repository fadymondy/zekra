/*
Lazy KaTeX and Mermaid. build/bundle.mjs copies their prebuilt browser builds
to out/renderer/vendor/ (both are desktop devDependencies); they are loaded
with a <script> tag the first time a document needs them, so app.js stays
small (mermaid alone is ~3 MB). script-src 'self' covers the sibling files.

Only the slice of each API the extras use is typed here, so no @types are
needed and nothing else in the renderer can come to depend on them.
*/

export type KatexApi = {
  renderToString(tex: string, opts: { displayMode: boolean; throwOnError: boolean; output?: "html" | "mathml" | "htmlAndMathml"; strict?: boolean | string }): string;
};

export type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

declare global {
  interface Window {
    katex?: KatexApi;
    mermaid?: MermaidApi;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`could not load ${src}`));
    };
    document.head.appendChild(s);
  });
}

let katexP: Promise<KatexApi> | null = null;
export function loadKatex(): Promise<KatexApi> {
  katexP ??= (async () => {
    if (!document.querySelector("link[data-zk-katex]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "vendor/katex/katex.min.css";
      link.dataset.zkKatex = "";
      document.head.appendChild(link);
    }
    await loadScript("vendor/katex/katex.min.js");
    if (!window.katex) throw new Error("KaTeX did not load");
    return window.katex;
  })().catch((e) => {
    katexP = null; // allow a retry
    throw e;
  });
  return katexP;
}

let mermaidP: Promise<MermaidApi> | null = null;
let mermaidTheme = "";
export async function loadMermaid(dark: boolean): Promise<MermaidApi> {
  mermaidP ??= loadScript("vendor/mermaid/mermaid.min.js")
    .then(() => {
      if (!window.mermaid) throw new Error("Mermaid did not load");
      return window.mermaid;
    })
    .catch((e) => {
      mermaidP = null;
      throw e;
    });
  const m = await mermaidP;
  const theme = dark ? "dark" : "default";
  if (theme !== mermaidTheme) {
    m.initialize({
      startOnLoad: false,
      // strict: no click handlers / HTML in labels, output sanitized.
      securityLevel: "strict",
      theme,
      fontFamily: "inherit",
      // SVG text instead of <foreignObject> labels, so a diagram can be
      // drawn onto a canvas for PNG export without tainting it.
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    mermaidTheme = theme;
  }
  return m;
}
