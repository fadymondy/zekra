// Unit tests for the pure importer converters (MH-450). They run against the
// tsc output, so `npm test` builds main first:
//   npm test            (= tsc -p tsconfig.main.json && node --test test/*.test.cjs)
// Nothing here touches Notes.app, the network or the user's files.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const out = path.join(__dirname, "..", "out");
const { htmlToMarkdown, extractHashtags, decodeEntities } = require(path.join(out, "main/importers/html-to-md.js"));
const { parseFrontmatter, frontmatterTags } = require(path.join(out, "shared/frontmatter.js"));
const { parseMarkdownNote, importMarkdownFolder } = require(path.join(out, "main/importers/markdown-folder.js"));
const { keepNoteToDraft, looksLikeKeepNote, importGoogleKeep } = require(path.join(out, "main/importers/google-keep.js"));
const notion = require(path.join(out, "main/importers/notion.js"));
const { appleNoteToDraft, parseAppleNotesOutput } = require(path.join(out, "main/importers/apple-notes.js"));

/* ------------------------------------------------------------ html-to-md */

test("apple notes div lines become one paragraph with hard breaks; empty div splits", () => {
  const md = htmlToMarkdown("<div>Line one</div><div>Line two</div><div><br></div><div>Next para</div>");
  assert.equal(md, "Line one  \nLine two\n\nNext para");
});

test("headings, emphasis, strike, links", () => {
  const md = htmlToMarkdown('<h1>Title</h1><p>Some <b>bold</b>, <i>it</i>, <s>gone</s> and <a href="https://x.dev/a b">a link</a>.</p>');
  assert.equal(md, "# Title\n\nSome **bold**, *it*, ~~gone~~ and [a link](https://x.dev/a%20b).");
});

test("bold keeps edge whitespace outside the markers", () => {
  assert.equal(htmlToMarkdown("<p>a<b> bold </b>b</p>"), "a **bold** b");
});

test("nested lists, including Apple Notes' list-in-list", () => {
  const md = htmlToMarkdown("<ul><li>one</li><ul><li>nested</li></ul><li>two<ol><li>a</li><li>b</li></ol></li></ul>");
  assert.equal(md, "- one\n  - nested\n- two\n  1. a\n  2. b");
});

test("checklists", () => {
  const md = htmlToMarkdown('<ul class="checklist"><li class="checked">done</li><li>todo</li></ul>');
  assert.equal(md, "- [x] done\n- [ ] todo");
  const md2 = htmlToMarkdown('<ul><li><input type="checkbox" checked> a</li><li><input type="checkbox"> b</li></ul>');
  assert.equal(md2, "- [x] a\n- [ ] b");
});

test("code: inline and blocks keep their text", () => {
  assert.equal(htmlToMarkdown("<p>run <code>a*b</code></p>"), "run `a*b`");
  assert.equal(htmlToMarkdown('<pre><code class="language-js">const a = 1 &lt; 2;\nx()</code></pre>'), "```js\nconst a = 1 < 2;\nx()\n```");
});

test("tables become GFM", () => {
  const md = htmlToMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table>");
  assert.equal(md, "| A | B |\n| --- | --- |\n| 1 | x\\|y |");
});

test("markdown characters in text are escaped, prose is left alone", () => {
  assert.equal(htmlToMarkdown("<div>2*3 = 6 and snake_case_name</div>"), "2\\*3 = 6 and snake_case_name");
  assert.equal(htmlToMarkdown("<div># not a heading</div>"), "\\# not a heading");
  assert.equal(htmlToMarkdown("<div>1. not a list</div>"), "1\\. not a list");
});

test("script/style dropped, entities decoded", () => {
  assert.equal(htmlToMarkdown("<style>p{}</style><p>a &amp; b &nbsp;&#x263A;</p><script>x</script>"), "a & b ☺");
  assert.equal(decodeEntities("&lt;&unknown;&#65;"), "<&unknown;A");
});

test("images go through the callback", () => {
  const seen = [];
  const md = htmlToMarkdown('<div><img src="data:image/png;base64,AAAA" alt="pic"></div>', {
    image: (src, alt) => {
      seen.push([src.slice(0, 15), alt]);
      return "![pic](zekra-attachment:1)";
    },
  });
  assert.deepEqual(seen, [["data:image/png;", "pic"]]);
  assert.equal(md, "![pic](zekra-attachment:1)");
});

test("blockquote and hr", () => {
  assert.equal(htmlToMarkdown("<blockquote><p>quoted</p><p>two</p></blockquote><hr>"), "> quoted\n>\n> two\n\n---");
});

test("hashtags", () => {
  assert.deepEqual(extractHashtags("a #Work item and #todo-list, not #1"), ["work", "todo-list"]);
});

/* ----------------------------------------------------------- frontmatter */

test("frontmatter: scalars, inline and block lists, body", () => {
  const r = parseFrontmatter('---\ntitle: "Hello: world"\ndraft: true\ncount: 3\ntags: [a, "b c"]\naliases:\n  - one\n  - two\n---\n\n# Body');
  assert.equal(r.found, true);
  assert.deepEqual(r.data, { title: "Hello: world", draft: true, count: 3, tags: ["a", "b c"], aliases: ["one", "two"] });
  assert.equal(r.body, "# Body");
});

test("frontmatter: unclosed block is not frontmatter", () => {
  const r = parseFrontmatter("---\ntitle: x\n# no close");
  assert.equal(r.found, false);
  assert.equal(r.body, "---\ntitle: x\n# no close");
});

test("frontmatter tags from list or string", () => {
  assert.deepEqual(frontmatterTags({ tags: "#one, two three" }), ["one", "two", "three"]);
  assert.deepEqual(frontmatterTags({ tags: ["x"], keywords: ["x", "y"] }), ["x", "y"]);
});

/* -------------------------------------------------------- markdown folder */

test("markdown note: frontmatter title and tags win, frontmatter stripped", () => {
  const n = parseMarkdownNote("---\ntitle: FM Title\ntags: [a, b]\npinned: true\n---\n# Heading\n\nText", "file.md");
  assert.equal(n.title, "FM Title");
  assert.deepEqual(n.tags, ["a", "b"]);
  assert.equal(n.pinned, true);
  assert.equal(n.body, "# Heading\n\nText");
});

test("markdown note: a leading H1 becomes the title and leaves the body", () => {
  const n = parseMarkdownNote("# My Note\n\nBody [[Other]]", "x.md");
  assert.equal(n.title, "My Note");
  assert.equal(n.body, "Body [[Other]]");
  assert.equal(parseMarkdownNote("Just text", "Plain Name.markdown").title, "Plain Name");
});

test("markdown folder import walks, skips hidden, rewrites local images", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zekra-test-md-"));
  try {
    fs.mkdirSync(path.join(dir, "sub"));
    fs.mkdirSync(path.join(dir, ".obsidian"));
    fs.writeFileSync(path.join(dir, "a.md"), "# A\n\n![x](sub/pic.png) and ![[pic.png]]");
    fs.writeFileSync(path.join(dir, "sub", "b.mdx"), "---\ntags: t\n---\nB body");
    fs.writeFileSync(path.join(dir, "sub", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(dir, ".obsidian", "c.md"), "hidden");
    const skipped = {};
    const { drafts } = await importMarkdownFolder(dir, {
      signal: new AbortController().signal,
      progress: () => {},
      warn: () => {},
      skip: (r) => (skipped[r] = (skipped[r] || 0) + 1),
    });
    assert.deepEqual(drafts.map((d) => d.title).sort(), ["A", "b"]);
    const a = drafts.find((d) => d.title === "A");
    assert.equal(a.attachments.length, 1, "same image referenced twice is uploaded once");
    assert.match(a.body, /^!\[x\]\(zekra-attachment:\w+\) and !\[pic\.png\]\(zekra-attachment:\w+\)$/);
    assert.deepEqual(drafts.find((d) => d.title === "b").tags, ["t"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ google keep */

test("keep: list notes, labels, pinned/archived, µs timestamps", () => {
  const n = {
    title: "",
    listContent: [{ text: "milk", isChecked: true }, { text: "eggs", isChecked: false }],
    labels: [{ name: "Shopping" }],
    isPinned: true,
    isArchived: true,
    createdTimestampUsec: 1700000000000000,
    userEditedTimestampUsec: "1700000001000000",
  };
  assert.equal(looksLikeKeepNote(n), true);
  const d = keepNoteToDraft(n);
  assert.equal(d.title, "milk");
  assert.equal(d.body, "- [x] milk\n- [ ] eggs");
  assert.deepEqual(d.tags, ["Shopping"]);
  assert.equal(d.pinned, true);
  assert.equal(d.archived, true);
  assert.equal(d.createdAt, "2023-11-14T22:13:20.000Z");
  assert.equal(d.updatedAt, "2023-11-14T22:13:21.000Z");
});

test("keep: takeout folder import skips trashed and non-notes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zekra-test-keep-"));
  try {
    const keep = path.join(dir, "Takeout", "Keep");
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(keep, "a.json"), JSON.stringify({ title: "A", textContent: "hello", attachments: [{ filePath: "p.jpeg", mimetype: "image/jpeg" }] }));
    fs.writeFileSync(path.join(keep, "p.jpg"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(keep, "t.json"), JSON.stringify({ title: "T", textContent: "x", isTrashed: true }));
    fs.writeFileSync(path.join(keep, "Labels.json"), JSON.stringify({ labels: [] }));
    const skipped = {};
    const { drafts } = await importGoogleKeep(dir, {
      signal: new AbortController().signal,
      progress: () => {},
      warn: () => {},
      skip: (r) => (skipped[r] = (skipped[r] || 0) + 1),
    });
    assert.equal(drafts.length, 1);
    assert.deepEqual(skipped, { trashed: 1 });
    assert.equal(drafts[0].attachments.length, 1, ".jpeg recorded, .jpg on disk");
    assert.match(drafts[0].body, /^hello\n\n!\[p\.jpg\]\(zekra-attachment:\w+\)$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ----------------------------------------------------------------- notion */

test("notion: hash stripping", () => {
  assert.deepEqual(notion.stripNotionHash("My Page 0123456789abcdef0123456789abcdef.md"), { name: "My Page.md", hash: "0123456789abcdef0123456789abcdef" });
  assert.equal(notion.stripNotionHashFromPath("A 0123456789abcdef0123456789abcdef/B 0123456789abcdef0123456789abcdef.md"), "A/B.md");
  assert.deepEqual(notion.stripNotionHash("plain.md"), { name: "plain.md" });
});

test("notion: page links become wiki links, callouts and toggles normalised", () => {
  const titles = new Map([["sub/other page.md", "Other Page"]]);
  const md = notion.normaliseNotionMarkdown(
    "See [the other](Other%20Page%200123456789abcdef0123456789abcdef.md) and [web](https://x.dev).\n\n<aside>\n💡 Tip here\n</aside>\n\n## ▸ Toggle\n\n    hidden body",
    "Sub",
    titles,
  );
  assert.match(md, /See \[\[Other Page\|the other\]\] and \[web\]\(https:\/\/x\.dev\)\./);
  assert.match(md, /> 💡 Tip here/);
  assert.match(md, /<details>\n<summary>Toggle<\/summary>\n\nhidden body\n\n<\/details>/);
});

test("notion: csv parsing and the database index", () => {
  const t = notion.parseCsv('﻿Name,Tags,Notes\r\nRow A,"x, y","multi\nline"\r\nRow B,,\r\n');
  assert.deepEqual(t.headers, ["Name", "Tags", "Notes"]);
  assert.deepEqual(t.rows, [["Row A", "x, y", "multi\nline"], ["Row B", "", ""]]);
  const md = notion.databaseIndexMarkdown(t, new Set(["row a"]));
  assert.match(md, /\| \[\[Row A\]\] \| x, y \| multi line \|/);
  assert.match(md, /\| Row B \|  \|  \|/);
});

test("notion: folder import (pages + database)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zekra-test-notion-"));
  const h = "0123456789abcdef0123456789abcdef";
  const h2 = "fedcba9876543210fedcba9876543210";
  try {
    fs.writeFileSync(path.join(dir, `Home ${h}.md`), `# Home\n\nGo to [Tasks](Tasks%20${h2}.csv) and [Row](Tasks%20${h2}/Row%20${h}.md)`);
    fs.mkdirSync(path.join(dir, `Tasks ${h2}`));
    fs.writeFileSync(path.join(dir, `Tasks ${h2}`, `Row ${h}.md`), "# Row\n\nStatus: Done");
    fs.writeFileSync(path.join(dir, `Tasks ${h2}.csv`), "Name,Status\nRow,Done\n");
    const { drafts } = await notion.importNotion(dir, { signal: new AbortController().signal, progress: () => {}, warn: () => {}, skip: () => {} });
    const titles = drafts.map((d) => d.title).sort();
    assert.deepEqual(titles, ["Home", "Row", "Tasks"]);
    const home = drafts.find((d) => d.title === "Home");
    assert.equal(home.body, "Go to [Tasks](Tasks.csv) and [[Row]]");
    assert.match(drafts.find((d) => d.title === "Tasks").body, /\| \[\[Row\]\] \| Done \|/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ apple notes */

test("apple notes: osascript output parsing and conversion (no Notes.app involved)", () => {
  const FS = "\u001f";
  const RS = "\u001e";
  const raw =
    ["x-coredata://1", "Groceries", "Home", "2024-01-02T03:04:05", "2024-01-03T03:04:05", "false", "photo.png|doc.pdf",
      '<div><h1>Groceries</h1></div><div>Buy #food</div><div><img src="data:image/png;base64,iVBORw0KGgo=" alt="photo"></div>'].join(FS) +
    RS +
    ["x-coredata://2", "Secret", "Notes", "2024-01-02T03:04:05", "2024-01-02T03:04:05", "true", "", ""].join(FS) +
    RS;
  const notes = parseAppleNotesOutput(raw);
  assert.equal(notes.length, 2);
  assert.equal(notes[1].locked, true);
  const d = appleNoteToDraft(notes[0]);
  assert.equal(d.title, "Groceries");
  assert.deepEqual(d.tags, ["Home", "food"]);
  assert.equal(d.attachments.length, 1);
  assert.equal(d.attachments[0].mime, "image/png");
  // The image <div> is the paragraph's next line (hard break), like on screen.
  assert.match(d.body, /^Buy #food  \n!\[photo\]\(zekra-attachment:\w+\)\n\n_Attachment not imported: doc\.pdf_$/);
});
