// Reuse the web console's own note renderer rather than a second markdown
// implementation. This single import is why desktop inherits the whole ported
// pipeline for free: marked + highlight.js -> DOMPurify, the code-block chrome
// and its actions menu, the interactive tables, and the reading themes — all
// of it, because the bundler aliases @ to the web app and compiles the same
// globals.css. Desktop previews cannot drift from what the web shows.
import { NoteMarkdown } from "@/components/notes/note-markdown";

export function Markdown({ text }: { text: string }) {
  return <NoteMarkdown text={text} />;
}
