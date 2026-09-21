import type { MarkdownStorage } from "tiptap-markdown"

/*
tiptap-markdown exports MarkdownStorage but does not augment TipTap's own
Storage interface, so `editor.storage.markdown` is a type error even though it
exists at runtime.

Declaring it here rather than casting at each call site: a cast would also
silence a genuine mistake, such as the extension not being registered.
*/
declare module "@tiptap/core" {
  interface Storage {
    markdown: MarkdownStorage
  }
}

export {}
