/*
The RN <-> WebView protocol for the note engine (MH-368).

Pure on purpose: this file is imported by BOTH sides — the React Native screen
(Metro) and the WebView bundle (esbuild, editor-web/) — and by node --test. So
it has no imports but types, and every message is plain JSON.

Wire format: every message is a JSON object carrying `zk: 1` next to its
`type`. The marker is what lets either side ignore messages it did not send
(react-native-webview also forwards anything a page posts, and a WebView page
can receive stray `message` events), and the per-type field check below is
what stops a malformed message from reaching a handler that assumes a shape.
*/

export type EngineMode = "rich" | "rendered" | "source";
export type EngineDir = "ltr" | "rtl" | "auto";
export type FontFamilyId = "system" | "serif" | "sans" | "mono" | "reading";

/** Formats the WebView can produce. md is plain text and pdf is printed by RN
 *  from the html result, so neither needs the engine. */
export type EngineExportFormat = "html" | "txt" | "docx" | "png";

export interface Typography {
  fontFamily: FontFamilyId;
  /** Body size in px, 12–24. */
  fontSize: number;
  /** Reading column cap in px; 0 = full width. */
  maxWidth: number;
  /** Code blocks fold long lines instead of scrolling sideways. */
  wordWrap: boolean;
  /** Line-number gutter on rendered code blocks. */
  lineNumbers: boolean;
  /** Horizontal page padding in px, so text clears the screen rails. */
  padX: number;
}

/** The app palette colours the engine needs when no reading theme is chosen. */
export interface EngineColors {
  bg: string;
  card: string;
  soft: string;
  line: string;
  ink: string;
  body: string;
  muted: string;
  action: string;
  gold: string;
  danger: string;
}

export interface EngineTheme {
  /** Reading theme id (web/lib/markdown/themes), or null for Zekra's palette. */
  id: string | null;
  scheme: "light" | "dark";
  colors: EngineColors;
}

/** UI strings the page shows; translated on the RN side. */
export interface EngineStrings {
  placeholder: string;
  lossyTitle: string;
  lossyBody: string;
  editSource: string;
  filter: string;
  rows: string;
  copy: string;
}

export type ToolbarCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "hr"
  | "link"
  | "undo"
  | "redo";

export interface ToolbarState {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  /** 0 = paragraph, 1–6 = heading level. */
  heading: number;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
  codeBlock: boolean;
  /** href of the link under the caret, or "" */
  link: string;
  canUndo: boolean;
  canRedo: boolean;
}

// ─── RN -> engine ───────────────────────────────────────────────────────────

export type ToEngine =
  | {
      type: "init";
      markdown: string;
      editable: boolean;
      theme: EngineTheme;
      typography: Typography;
      dir: EngineDir;
      strings: EngineStrings;
      /** Put the caret in the document once it is ready (a new note). */
      autofocus: boolean;
    }
  | { type: "setTheme"; theme: EngineTheme }
  | { type: "setTypography"; typography: Typography }
  | { type: "setMarkdown"; markdown: string }
  | { type: "setEditable"; editable: boolean }
  | { type: "getMarkdown"; id: number }
  | { type: "insertImage"; url: string; alt: string }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "exec"; command: ToolbarCommand; arg?: string }
  /** `url` is a data: URL for an auth-gated image, or the original URL
   *  when the image is public and the page may load it directly. */
  | { type: "imageResolved"; src: string; url: string }
  | { type: "imageFailed"; src: string }
  | {
      type: "export";
      id: number;
      format: EngineExportFormat;
      markdown: string;
      title: string;
      themeId: string | null;
      dir: EngineDir;
    };

// ─── engine -> RN ───────────────────────────────────────────────────────────

export type FromEngine =
  | { type: "ready" }
  | { type: "change"; markdown: string }
  | { type: "markdown"; id: number; markdown: string }
  | { type: "mode"; mode: EngineMode; lossy: string[] }
  | { type: "height"; height: number }
  | { type: "focus" }
  | { type: "blur" }
  | { type: "state"; state: ToolbarState }
  | { type: "pasteImage"; dataUrl: string; mime: string; name: string }
  | { type: "link"; href: string }
  | { type: "imageRequest"; src: string }
  | { type: "copy"; text: string }
  | {
      type: "exportResult";
      id: number;
      ok: boolean;
      data?: string;
      encoding?: "base64" | "utf8";
      error?: string;
    }
  | { type: "error"; message: string };

// ─── Codec ──────────────────────────────────────────────────────────────────

type FieldKind = "string" | "number" | "boolean" | "object" | "array";
type Shape = Record<string, FieldKind>;

/** Required fields per message type. Optional fields are not listed. */
const TO_ENGINE: Record<ToEngine["type"], Shape> = {
  init: { markdown: "string", editable: "boolean", theme: "object", typography: "object", dir: "string", strings: "object", autofocus: "boolean" },
  setTheme: { theme: "object" },
  setTypography: { typography: "object" },
  setMarkdown: { markdown: "string" },
  setEditable: { editable: "boolean" },
  getMarkdown: { id: "number" },
  insertImage: { url: "string", alt: "string" },
  focus: {},
  blur: {},
  exec: { command: "string" },
  imageResolved: { src: "string", url: "string" },
  imageFailed: { src: "string" },
  export: { id: "number", format: "string", markdown: "string", title: "string", dir: "string" },
};

const FROM_ENGINE: Record<FromEngine["type"], Shape> = {
  ready: {},
  change: { markdown: "string" },
  markdown: { id: "number", markdown: "string" },
  mode: { mode: "string", lossy: "array" },
  height: { height: "number" },
  focus: {},
  blur: {},
  state: { state: "object" },
  pasteImage: { dataUrl: "string", mime: "string", name: "string" },
  link: { href: "string" },
  imageRequest: { src: "string" },
  copy: { text: "string" },
  exportResult: { id: "number", ok: "boolean" },
  error: { message: "string" },
};

export const WIRE_MARK = 1;

function kindOf(v: unknown): FieldKind | "other" {
  if (Array.isArray(v)) return "array";
  if (v === null) return "other";
  const t = typeof v;
  if (t === "number") return Number.isFinite(v) ? "number" : "other";
  return t === "string" || t === "boolean" || t === "object" ? t : "other";
}

function decodeWith<T>(raw: unknown, shapes: Record<string, Shape>): T | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const msg = value as Record<string, unknown>;
  if (msg.zk !== WIRE_MARK || typeof msg.type !== "string") return null;
  const shape = Object.prototype.hasOwnProperty.call(shapes, msg.type) ? shapes[msg.type] : undefined;
  if (!shape) return null;
  for (const [field, kind] of Object.entries(shape)) {
    if (kindOf(msg[field]) !== kind) return null;
  }
  const { zk: _mark, ...rest } = msg;
  return rest as T;
}

export function encode(msg: ToEngine | FromEngine): string {
  return JSON.stringify({ zk: WIRE_MARK, ...msg });
}

export function decodeToEngine(raw: unknown): ToEngine | null {
  return decodeWith<ToEngine>(raw, TO_ENGINE);
}

export function decodeFromEngine(raw: unknown): FromEngine | null {
  return decodeWith<FromEngine>(raw, FROM_ENGINE);
}

/**
 * The JavaScript RN injects to deliver one message. The payload is embedded
 * as a JSON string literal (JSON.stringify of the encoded string), so no note
 * content can ever be interpreted as code — quotes, backslashes, `</script>`
 * and U+2028 all arrive as data.
 */
export function injectionFor(msg: ToEngine): string {
  return `window.__zk&&window.__zk.receive(${JSON.stringify(encode(msg))});true;`;
}
