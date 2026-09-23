import { Editor, type AnyExtension } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { defaultMarkdownSerializer, type MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

import { editorExtensions } from "../../web/components/notes/editor-extensions.ts";
import { findLossyConstructs } from "../../web/components/notes/lossy-markdown.ts";
import type { EngineMode, EngineStrings, ToEngine, ToolbarCommand, ToolbarState, Typography } from "../src/features/editor/bridge-core.ts";
import { chooseMode, nextHeading } from "../src/features/editor/engine-core.ts";
import { debounced, errorText, listen, post } from "./bridge.mts";
import { CodeHighlight } from "./code-highlight.mts";
import { imageFailed, imageResolved, loadInto } from "./images.mts";
import { applyLineNumbers, installReaderBehaviour, renderInto, setReaderLabels } from "./reader.mts";
import { CSS } from "./styles.mts";
import { applyDir, applyTheme, applyTypography } from "./theme.mts";

/*
The note engine page (MH-368): one document surface in three modes.

  rich      TipTap with web's exact schema (editorExtensions) — Apple Notes
            style always-on WYSIWYG: markdown shortcuts (# , - , 1. , > , ```,
            [ ] , **bold**) become formatting as you type via the extensions'
            input rules; pasted markdown text is parsed as markdown
            (tiptap-markdown transformPastedText); pasted HTML keeps its
            structure; pasted/dropped images go to RN to upload.
  rendered  web's renderer, read-only (read-only brains; lossy notes).
  source    a plain markdown textarea, for notes TipTap would damage.

The markdown string is the source of truth. It is what RN sends and what
comes back (editor.storage.markdown.getMarkdown()); nothing the page does to
display a note (resolved image URLs, dir attributes, table sorting) is ever
written into it.
*/

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);

const root = document.getElementById("zk-root") as HTMLElement;

let markdown = "";
let editable = false;
let sourceRequested = false;
let mode: EngineMode | null = null;
let strings: EngineStrings = {
  placeholder: "",
  lossyTitle: "",
  lossyBody: "",
  editSource: "Edit as markdown",
  filter: "Filter…",
  rows: "rows",
  copy: "Copy",
};
let typography: Typography | null = null;
let editor: Editor | null = null;
let source: HTMLTextAreaElement | null = null;
let lastPosted = "";

/** tiptap-markdown's storage; its package does not augment TipTap's Storage type. */
type MarkdownStorage = { markdown: { getMarkdown(): string } };

// ─── change reporting ───────────────────────────────────────────────────────

function currentMarkdown(): string {
  if (mode === "rich" && editor) return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
  if (mode === "source" && source) return source.value;
  return markdown;
}

const change = debounced(() => {
  markdown = currentMarkdown();
  if (markdown === lastPosted) return;
  lastPosted = markdown;
  post({ type: "change", markdown });
}, 250);

// ─── toolbar state ──────────────────────────────────────────────────────────

let lastState = "";
let stateFrame = 0;

function reportState(): void {
  if (stateFrame) return;
  stateFrame = requestAnimationFrame(() => {
    stateFrame = 0;
    if (!editor) return;
    const e = editor;
    let heading = 0;
    for (let level = 1; level <= 6; level += 1) if (e.isActive("heading", { level })) heading = level;
    const state: ToolbarState = {
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      heading,
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      taskList: e.isActive("taskList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      link: (e.getAttributes("link").href as string | undefined) ?? "",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    };
    const key = JSON.stringify(state);
    if (key === lastState) return;
    lastState = key;
    post({ type: "state", state });
  });
}

// ─── images: TipTap node view that resolves through RN ─────────────────────

/*
The schema's Image node, with a node view that loads the picture through the
RN resolver. The node's `src` attribute (what tiptap-markdown serialises) is
never touched — only the DOM <img> gets the resolved URL — and ignoreMutation
stops ProseMirror from reading that DOM change back into the document.
*/
const AuthImage = Image.extend({
  /*
  The schema makes images BLOCK nodes (inline: false), but tiptap-markdown
  serialises them with prosemirror-markdown's inline image writer, which never
  closes the block — so "![a](x)\n\nNext paragraph" came back as
  "![a](x)Next paragraph", fusing the image into the following text on every
  save. Closing the block after writing keeps the blank line. (web has the
  same schema and the same defect.)
  */
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) {
          defaultMarkdownSerializer.nodes.image(state, node, parent, index);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      let src = String(node.attrs.src ?? "");
      if (node.attrs.alt) img.alt = String(node.attrs.alt);
      if (node.attrs.title) img.title = String(node.attrs.title);
      void loadInto(img, src);
      return {
        dom: img,
        update(next) {
          if (next.type !== node.type) return false;
          const nextSrc = String(next.attrs.src ?? "");
          if (nextSrc !== src) {
            src = nextSrc;
            void loadInto(img, src);
          }
          img.alt = String(next.attrs.alt ?? "");
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
}).configure({ inline: false, allowBase64: false });

function extensions(): AnyExtension[] {
  const base = editorExtensions().filter((ext) => ext.name !== "image");
  return [
    ...base,
    AuthImage,
    Placeholder.configure({ placeholder: () => strings.placeholder, showOnlyWhenEditable: true }),
    CodeHighlight,
  ] as AnyExtension[];
}

// ─── paste / drop images ────────────────────────────────────────────────────

function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  if (!out.length) for (const f of Array.from(list.files ?? [])) if (f.type.startsWith("image/")) out.push(f);
  return out;
}

function sendImages(files: File[]): void {
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = () => {
      post({ type: "pasteImage", dataUrl: String(reader.result), mime: file.type || "image/png", name: file.name || "pasted.png" });
    };
    reader.onerror = () => post({ type: "error", message: "Could not read the pasted image" });
    reader.readAsDataURL(file);
  }
}

// ─── modes ──────────────────────────────────────────────────────────────────

function teardown(): void {
  change.flush();
  if (editor) {
    editor.destroy();
    editor = null;
  }
  source = null;
  root.replaceChildren();
  root.className = "";
}

function mountRich(autofocus: boolean): void {
  root.className = "zk-prose zk-editor";
  const host = document.createElement("div");
  root.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: extensions(),
    content: markdown,
    editable: true,
    // Every block gets dir="auto": mixed Arabic/English paragraphs each align
    // by their own text, like the web reader's dir="auto".
    textDirection: "auto",
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: { autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" },
      handlePaste(_view, event) {
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        sendImages(files);
        return true;
      },
      handleDrop(_view, event) {
        const files = imageFiles((event as DragEvent).dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        sendImages(files);
        return true;
      },
      handleClickOn(_view, _pos, node, _nodePos, event) {
        // A tap on a link while NOT editing text (no caret intent) is
        // impossible to distinguish on touch, so links open only when the
        // editor is not focused — the first tap focuses, as in Apple Notes.
        const a = (event.target as HTMLElement | null)?.closest?.("a[href]");
        if (a && !editor?.isFocused && node) {
          event.preventDefault();
          post({ type: "link", href: a.getAttribute("href") ?? "" });
          return true;
        }
        return false;
      },
    },
    onUpdate: () => {
      change.schedule();
      reportState();
    },
    onSelectionUpdate: reportState,
    onFocus: () => {
      post({ type: "focus" });
      reportState();
    },
    onBlur: () => {
      change.flush();
      post({ type: "blur" });
    },
  });
  reportState();
}

function mountSource(autofocus: boolean): void {
  root.className = "zk-source-wrap";
  const area = document.createElement("textarea");
  area.className = "zk-source";
  area.value = markdown;
  area.dir = "auto";
  area.spellcheck = false;
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("autocorrect", "off");
  const grow = () => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  };
  area.addEventListener("input", () => {
    grow();
    change.schedule();
  });
  area.addEventListener("focus", () => post({ type: "focus" }));
  area.addEventListener("blur", () => {
    change.flush();
    post({ type: "blur" });
  });
  root.appendChild(area);
  source = area;
  requestAnimationFrame(grow);
  if (autofocus) area.focus();
}

function mountRendered(): void {
  root.className = "zk-prose zk-reader";
  const lossy = editable ? findLossyConstructs(markdown) : [];
  if (lossy.length) {
    const banner = document.createElement("div");
    banner.className = "zk-banner";
    banner.dir = "auto";
    const title = document.createElement("strong");
    title.textContent = strings.lossyTitle;
    const body = document.createElement("p");
    body.textContent = strings.lossyBody;
    const samples = document.createElement("p");
    for (const finding of lossy) {
      const code = document.createElement("code");
      code.textContent = finding.sample;
      samples.appendChild(code);
      samples.appendChild(document.createElement("br"));
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = strings.editSource;
    button.addEventListener("click", () => {
      sourceRequested = true;
      setMode(true);
    });
    banner.append(title, body, samples, button);
    root.appendChild(banner);
  }
  const article = document.createElement("article");
  root.appendChild(article);
  void renderInto(article, markdown, typography?.lineNumbers ?? false);
}

/** (Re)decide the mode and mount it if it changed (or `force`). */
function setMode(focusAfter = false, force = false): void {
  const lossy = findLossyConstructs(markdown);
  const next = chooseMode({ editable, lossy: lossy.length > 0, sourceRequested });
  if (next === mode && !force) return;
  teardown();
  mode = next;
  if (next === "rich") mountRich(focusAfter);
  else if (next === "source") mountSource(focusAfter);
  else mountRendered();
  post({ type: "mode", mode: next, lossy: lossy.map((l) => l.kind) });
}

// ─── toolbar commands ───────────────────────────────────────────────────────

function exec(command: ToolbarCommand, arg?: string): void {
  if (!editor || mode !== "rich") return;
  const chain = () => editor!.chain().focus();
  switch (command) {
    case "bold":
      chain().toggleBold().run();
      break;
    case "italic":
      chain().toggleItalic().run();
      break;
    case "strike":
      chain().toggleStrike().run();
      break;
    case "code":
      chain().toggleCode().run();
      break;
    case "heading": {
      let level = 0;
      for (let l = 1; l <= 6; l += 1) if (editor.isActive("heading", { level: l })) level = l;
      const next = nextHeading(level);
      if (next === 0) chain().setParagraph().run();
      else chain().setHeading({ level: next as 1 | 2 | 3 }).run();
      break;
    }
    case "bulletList":
      chain().toggleBulletList().run();
      break;
    case "orderedList":
      chain().toggleOrderedList().run();
      break;
    case "taskList":
      chain().toggleTaskList().run();
      break;
    case "blockquote":
      chain().toggleBlockquote().run();
      break;
    case "codeBlock":
      chain().toggleCodeBlock().run();
      break;
    case "hr":
      chain().setHorizontalRule().run();
      break;
    case "link": {
      const href = (arg ?? "").trim();
      if (!href) {
        chain().extendMarkRange("link").unsetLink().run();
      } else if (editor.state.selection.empty && !editor.isActive("link")) {
        chain().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
      } else {
        chain().extendMarkRange("link").setLink({ href }).run();
      }
      break;
    }
    case "undo":
      chain().undo().run();
      break;
    case "redo":
      chain().redo().run();
      break;
  }
}

function insertImage(url: string, alt: string): void {
  if (mode === "rich" && editor) {
    editor.chain().focus().setImage({ src: url, alt }).run();
  } else if (mode === "source" && source) {
    const snippet = `\n![${alt}](${url})\n`;
    const { selectionStart: s, selectionEnd: e, value } = source;
    source.value = value.slice(0, s) + snippet + value.slice(e);
    source.selectionStart = source.selectionEnd = s + snippet.length;
    source.dispatchEvent(new Event("input"));
  }
}

// ─── size reporting (for auto-height hosts) ─────────────────────────────────

let lastHeight = 0;
new ResizeObserver(() => {
  const height = Math.ceil(document.documentElement.scrollHeight);
  if (Math.abs(height - lastHeight) < 2) return;
  lastHeight = height;
  post({ type: "height", height });
}).observe(document.body);

// The keyboard shrinks the WebView; keep the caret in view when it does.
window.addEventListener("resize", () => {
  if (editor?.isFocused) editor.commands.scrollIntoView();
  else if (source && document.activeElement === source) source.scrollIntoView({ block: "nearest" });
});

// ─── bridge ─────────────────────────────────────────────────────────────────

installReaderBehaviour(root);

listen((msg: ToEngine) => {
  switch (msg.type) {
    case "init":
      markdown = msg.markdown;
      lastPosted = msg.markdown;
      editable = msg.editable;
      strings = msg.strings;
      typography = msg.typography;
      setReaderLabels({ rows: strings.rows, filter: strings.filter });
      applyTheme(msg.theme);
      applyTypography(msg.typography);
      applyDir(msg.dir);
      setMode(msg.autofocus, true);
      break;
    case "setTheme":
      applyTheme(msg.theme);
      break;
    case "setTypography":
      typography = msg.typography;
      applyTypography(msg.typography);
      applyLineNumbers(root, msg.typography.lineNumbers);
      break;
    case "setMarkdown":
      // Replacing the whole body (reload after a conflict, version restore).
      change.cancel();
      markdown = msg.markdown;
      lastPosted = msg.markdown;
      if (mode === "rich" && editor && chooseMode({ editable, lossy: findLossyConstructs(markdown).length > 0, sourceRequested }) === "rich") {
        editor.commands.setContent(markdown, { emitUpdate: false });
      } else {
        setMode(false, true);
      }
      break;
    case "setEditable":
      markdown = currentMarkdown();
      editable = msg.editable;
      setMode();
      break;
    case "getMarkdown":
      change.flush();
      post({ type: "markdown", id: msg.id, markdown: currentMarkdown() });
      break;
    case "insertImage":
      insertImage(msg.url, msg.alt);
      break;
    case "focus":
      if (editor) editor.commands.focus();
      else source?.focus();
      break;
    case "blur":
      editor?.commands.blur();
      (document.activeElement as HTMLElement | null)?.blur?.();
      break;
    case "exec":
      exec(msg.command, msg.arg);
      break;
    case "imageResolved":
      imageResolved(msg.src, msg.url);
      break;
    case "imageFailed":
      imageFailed(msg.src);
      break;
    case "export":
      post({ type: "exportResult", id: msg.id, ok: false, error: "export runs in the export host" });
      break;
  }
});

try {
  post({ type: "ready" });
} catch (e) {
  post({ type: "error", message: errorText(e) });
}
