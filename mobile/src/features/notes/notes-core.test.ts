import assert from "node:assert/strict";
import { test } from "node:test";

import type { Note, NotePage } from "../../lib/api.ts";
import { CATEGORY_ICONS, CATEGORY_ICON_NAMES } from "../../../../web/lib/notes/note-icon-map.ts";
import {
  ago,
  applyNote,
  edgeFromTravel,
  edgeOf,
  fullSwipeArmed,
  listParams,
  matchesFilter,
  NOTE_COLORS,
  NOTE_ICON_NAMES,
  noteMarkdown,
  physicalOf,
  physicalOrder,
  removeNote,
  rowPreview,
  snippet,
  stripMarkdown,
  visibleNotes,
} from "./notes-core.ts";

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    namespace: "ns",
    title: id,
    body: "",
    tags: [],
    pinned: false,
    archived: false,
    deleted: false,
    source: "test",
    version: 1,
    chunks: 0,
    indexed: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const page = (...notes: Note[]): NotePage => ({ notes, serverTime: "2026-01-01T00:00:00Z" });

test("listParams: archived view asks for browse mode, pinned is server-side", () => {
  assert.deepEqual(listParams("b", { filter: "all", sort: "updated", q: "" }), { namespace: "b", limit: "40" });
  assert.deepEqual(listParams("b", { filter: "archived", sort: "title", q: "x y" }, "c1"), {
    namespace: "b",
    limit: "200",
    q: "x y",
    archived: "1",
    sort: "title",
    cursor: "c1",
  });
  assert.equal(listParams("b", { filter: "pinned", sort: "updated", q: "" }).pinned, "1");
});

test("matchesFilter mirrors the server's view rules", () => {
  assert.equal(matchesFilter(note("a"), "all"), true);
  assert.equal(matchesFilter(note("a", { archived: true }), "all"), false);
  assert.equal(matchesFilter(note("a", { archived: true }), "archived"), true);
  assert.equal(matchesFilter(note("a"), "archived"), false);
  assert.equal(matchesFilter(note("a", { pinned: true }), "pinned"), true);
  assert.equal(matchesFilter(note("a", { pinned: true, archived: true }), "pinned"), false);
  assert.equal(matchesFilter(note("a", { deleted: true }), "all"), false);
});

test("visibleNotes de-duplicates across pages and filters the archived view", () => {
  const pages = [page(note("a"), note("b", { archived: true })), page(note("a"), note("c"))];
  assert.deepEqual(visibleNotes(pages, "all").map((n) => n.id), ["a", "c"]);
  assert.deepEqual(visibleNotes(pages, "archived").map((n) => n.id), ["b"]);
});

test("applyNote replaces in place, or drops a note that left the view", () => {
  const pages = [page(note("a"), note("b"))];
  const pinned = applyNote(pages, note("b", { pinned: true, version: 2 }), "all");
  assert.equal(pinned[0].notes[1].pinned, true);
  assert.equal(pinned[0].notes[1].version, 2);
  const archived = applyNote(pages, note("b", { archived: true }), "all");
  assert.deepEqual(archived[0].notes.map((n) => n.id), ["a"]);
  // Pages without the note are returned untouched (same reference).
  const other = page(note("z"));
  assert.equal(applyNote([other], note("b"), "all")[0], other);
  assert.deepEqual(removeNote(pages, "a")[0].notes.map((n) => n.id), ["b"]);
});

test("stripMarkdown reads as prose", () => {
  assert.equal(stripMarkdown("# Title\n\nSome **bold** and _em_ text."), "Title Some bold and em text.");
  assert.equal(stripMarkdown("- [x] done\n- [ ] todo\n1. first"), "done todo first");
  assert.equal(stripMarkdown("See [the docs](https://x.y) and ![a cat](c.png)"), "See the docs and a cat");
  assert.equal(stripMarkdown("> quoted\n\n---\n\n`code` here"), "quoted code here");
  assert.equal(stripMarkdown("```go\nfunc main() {}\n```"), "func main() {}");
  assert.equal(stripMarkdown("| a | b |\n|---|---|\n| 1 | 2 |"), "a b 1 2");
  assert.equal(stripMarkdown("keep snake_case_names"), "keep snake_case_names");
  assert.equal(stripMarkdown("[[Venture X|the venture]] and [[Plain]]"), "the venture and Plain");
  assert.equal(stripMarkdown("~~gone~~ <b>html</b>"), "gone html");
});

test("snippet caps length and handles empty bodies", () => {
  assert.equal(snippet(undefined), "");
  assert.equal(snippet(""), "");
  const long = snippet("word ".repeat(200), 20);
  assert.ok(long.endsWith("…"));
  assert.ok(long.length <= 21);
});

test("rowPreview prefers a non-empty description over the body snippet", () => {
  assert.equal(rowPreview({ description: "  Short summary ", body: "# Body" }), "Short summary");
  assert.equal(rowPreview({ description: "   ", body: "# Body" }), "Body");
  assert.equal(rowPreview({ body: "**Body**" }), "Body");
});

test("noteMarkdown prefixes the title as a heading", () => {
  assert.equal(noteMarkdown({ title: "T", body: "b\n" }), "# T\n\nb");
  assert.equal(noteMarkdown({ title: "", body: "only body" }), "only body");
  assert.equal(noteMarkdown({ title: "T", body: "" }), "# T");
});

test("ago buckets", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  assert.deepEqual(ago("2026-09-23T11:59:30Z", now), { unit: "now", n: 0 });
  assert.deepEqual(ago("2026-09-23T12:00:30Z", now), { unit: "now", n: 0 });
  assert.deepEqual(ago("2026-09-23T11:15:00Z", now), { unit: "m", n: 45 });
  assert.deepEqual(ago("2026-09-23T07:00:00Z", now), { unit: "h", n: 5 });
  assert.deepEqual(ago("2026-09-20T12:00:00Z", now), { unit: "d", n: 3 });
  assert.equal(ago("2026-09-01T12:00:00Z", now).unit, "date");
  assert.equal(ago("not a date", now).unit, "date");
});

test("swipe sides map logical edges to physical panels in both directions", () => {
  assert.equal(physicalOf("start", false), "left");
  assert.equal(physicalOf("end", false), "right");
  assert.equal(physicalOf("start", true), "right");
  assert.equal(physicalOf("end", true), "left");
  for (const rtl of [false, true]) {
    for (const edge of ["start", "end"] as const) assert.equal(edgeOf(physicalOf(edge, rtl), rtl), edge);
  }
  // Travelling right uncovers the left panel: the start edge in LTR, the end in RTL.
  assert.equal(edgeFromTravel("right", false), "start");
  assert.equal(edgeFromTravel("right", true), "end");
  assert.equal(edgeFromTravel("left", false), "end");
  assert.equal(edgeFromTravel("left", true), "start");
});

test("physicalOrder puts the outer (full-swipe) button at the screen edge", () => {
  // Declared inner -> outer.
  assert.deepEqual(physicalOrder(["delete", "archive"], "right"), ["delete", "archive"]);
  assert.deepEqual(physicalOrder(["delete", "archive"], "left"), ["archive", "delete"]);
});

test("fullSwipeArmed needs real travel past the panel", () => {
  assert.equal(fullSwipeArmed(100, 84, 390), false);
  assert.equal(fullSwipeArmed(240, 84, 390), true);
  assert.equal(fullSwipeArmed(-300, 84, 390), false);
  assert.equal(fullSwipeArmed(300, 0, 390), false);
  // A wide panel on a narrow row still needs travel beyond the panel itself.
  assert.equal(fullSwipeArmed(200, 168, 300), false);
  assert.equal(fullSwipeArmed(233, 168, 300), true);
});

test("appearance options are exactly the shared map's icons and colours", () => {
  assert.equal(NOTE_ICON_NAMES.length, 15);
  assert.deepEqual(new Set(NOTE_ICON_NAMES), new Set(CATEGORY_ICON_NAMES));
  const mapColors = new Set(Object.values(CATEGORY_ICONS).map((s) => s.color).filter((c) => c.startsWith("#")));
  assert.equal(NOTE_COLORS.length, 13);
  assert.deepEqual(new Set(NOTE_COLORS), mapColors);
});
