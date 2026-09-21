// Reuse the web console's own note renderer rather than a second markdown
// implementation — same react-markdown + remark-gfm and the same grid-token
// styling (including the list-indent fix), so desktop previews cannot drift
// from what the web shows for the same note.
import { NoteMarkdown } from "@/components/notes/note-markdown";

export function Markdown({ text }: { text: string }) {
  return <NoteMarkdown text={text} />;
}
