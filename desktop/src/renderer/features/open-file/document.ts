import { frontmatterTags, parseFrontmatter } from "../../../shared/frontmatter";

/*
An opened Markdown file as a Zekra note: same rules as the markdown-folder
importer (src/main/importers/markdown-folder.ts parseMarkdownNote), so a file
imported on its own lands exactly like one imported with its folder:
  title  frontmatter `title` > a leading `# H1` (then removed from the body) >
         the file name
  tags   frontmatter tags
  body   without the frontmatter
Pure — no DOM, no bridge.
*/
export type DocumentNote = { title: string; body: string; tags: string[] };

export function documentToNote(content: string, fileName: string): DocumentNote {
  const fm = parseFrontmatter((content ?? "").replace(/\r\n/g, "\n"));
  let body = fm.body;
  const fmTitle = typeof fm.data.title === "string" ? fm.data.title.trim() : "";
  let title = fmTitle;
  if (!title) {
    const h1 = /^\s*#\s+(.+?)\s*#*\s*$/m.exec(body);
    const firstContent = body.split("\n").find((l) => l.trim() !== "");
    if (h1 && firstContent !== undefined && firstContent.trim() === h1[0].trim()) {
      title = h1[1].trim();
      body = body.replace(h1[0], "").replace(/^\s*\n/, "");
    }
  }
  if (!title) title = fileName.replace(/\.(md|markdown|mdx)$/i, "");
  return { title, body: body.trim(), tags: frontmatterTags(fm.data) };
}

export function wordCount(text: string): number {
  const m = (text ?? "").replace(/```[\s\S]*?```/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu);
  return m ? m.length : 0;
}
