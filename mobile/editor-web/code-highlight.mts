import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import hljs from "highlight.js/lib/common";

/*
Syntax colouring INSIDE the rich editor's code blocks, with the same
highlight.js grammars and token classes the reader uses — so a block looks the
same whether it is being read or typed into.

Done as ProseMirror decorations over the plain text rather than by changing
the document: the stored markdown stays exactly what was typed, and
@tiptap/extension-code-block-lowlight (which does this upstream) would need
lowlight as a new dependency.

hljs returns HTML; it is parsed with an inert <template> (nothing executes or
loads) and walked to turn each span's classes into an inline decoration over
the same character range.
*/

type Span = { from: number; to: number; cls: string };

const cache = new Map<string, Span[]>();
const CACHE_MAX = 200;
/** Very long blocks are left plain: highlighting is per keystroke. */
const MAX_CHARS = 20_000;

function spansFor(text: string, language: string): Span[] {
  const key = `${language}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let html: string;
  try {
    html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return [];
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const out: Span[] = [];
  let offset = 0;
  const walk = (node: Node, classes: string[]) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const len = (child.textContent ?? "").length;
        if (classes.length && len) out.push({ from: offset, to: offset + len, cls: classes.join(" ") });
        offset += len;
      } else if (child.nodeType === 1) {
        const own = (child as Element).getAttribute("class") ?? "";
        walk(child, own ? [...classes, own] : classes);
      }
    });
  };
  walk(tpl.content, []);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, out);
  return out;
}

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;
    const language = String(node.attrs.language ?? "").trim();
    const text = node.textContent;
    if (language && text.length <= MAX_CHARS && hljs.getLanguage(language)) {
      for (const span of spansFor(text, language)) {
        decorations.push(Decoration.inline(pos + 1 + span.from, pos + 1 + span.to, { class: span.cls }));
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

const key = new PluginKey<DecorationSet>("zkCodeHighlight");

export const CodeHighlight = Extension.create({
  name: "zkCodeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
