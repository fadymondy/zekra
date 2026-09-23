import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
} from "react";
import { createPortal } from "react-dom";
import { Code2, Ellipsis, Info, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { findLossyConstructs } from "@/components/notes/lossy-markdown";
import { NoteEditorWysiwyg } from "@/components/notes/note-editor-wysiwyg";
import { useNoteSettings } from "@/components/notes/note-settings-panel";
import { imageFilesFrom } from "@/lib/notes/upload-image";
import { cn } from "@/lib/utils";

import { Autosaver, type AutosaveStatus } from "@mobile/features/editor/autosave-core";

import { IconButton } from "../../components/chrome";
import { Markdown } from "../../components/markdown";
import type { Brain, Note, NotePatch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useCommand } from "../../shell/commands";
import { useSlot } from "../../shell/slots";
import { toast } from "../../shell/toast";
import { notesApi, overwriteNote, saveNote } from "../notes/notes-api";
import { textStats } from "../notes/notes-model";
import { AppearancePicker, NoteIconTile } from "./appearance-picker";
import { uploadNoteImage, useAuthedImagesIn } from "./authed-dom-images";
import { FindBar, OutlineRail } from "./editor-chrome";
import { exportNote, type ExportFormat } from "./export";
import {
  clearHighlights,
  domMatches,
  ensureFindStyles,
  lineCol,
  paintHighlights,
  revealInTextarea,
  scrollRangeIntoView,
  textMatches,
} from "./find";
import { CategoryPicker, TagEditor } from "./note-meta";
import { activeHeading, headingElements, outlineOf, type OutlineItem } from "./outline";
import type { DeskTab } from "./tab-groups";

/*
One open note, Apple Notes style: ONE live surface you read and edit at once.

  header   icon/colour tile (click: picker) · title (wraps; Enter → description)
           · description (muted, 1–3 lines) · category + tags
  body     the web's TipTap WYSIWYG (NoteEditorWysiwyg) — always. Markdown
           shortcuts and paste render as you type.

There is no Live/Source/Split/Preview switch. The markdown source is a
secondary view (View ▸ View Markdown Source ⌥⌘U, or the "…" menu), shown in
place of the body with a Done button. A note whose markdown TipTap cannot
round-trip (footnotes, raw HTML blocks — web lossy-markdown.ts) is shown
rendered, read-only, with an inline "Edit as Markdown" that opens the source
view; editing it live would rewrite the author's content. A read-only brain
gets the same surface, non-editable.

Every text block reads in its own direction (an English note in the Arabic UI
starts at the left) — the editor schema's BlockDirection decorations, plus
unicode-bidi: plaintext in the rendered/read views (find.ts styles).

Saving is mobile's autosave (autosave-core.ts): 800 ms after the last change,
and at once on blur, on ⌘S, when the tab is switched or closed (unmount). It
covers title, description, tags, category, icon and colour like the body, in
the same PUT with the version. A new note (tab.id null) is created by its
FIRST save — the server rejects empty notes, so an untouched draft never
reaches it. A 409 stops autosave and shows the conflict banner: Reload theirs /
Overwrite.

While its group is focused the editor also owns: the status-bar items (words,
characters, cursor in source, save state), ⌘F find, ⌘S save, Note ▸ Rename
(⌘R / F2), View Markdown Source, the File ▸ Export commands, and the outline
rail (portalled into the workspace's rail).
*/

type Snapshot = {
  title: string;
  description: string;
  body: string;
  tags: string[];
  category: string;
  icon: string;
  color: string;
};

const snapOf = (n: Note | null | undefined): Snapshot => ({
  title: n?.title ?? "",
  // Absent on servers that predate descriptions: read as empty.
  description: n?.description ?? "",
  body: n?.body ?? "",
  tags: n?.tags ?? [],
  category: n?.category ?? "",
  icon: n?.icon ?? "",
  color: n?.color ?? "",
});

/** The server caps descriptions at 500 characters (notes.go). */
const DESCRIPTION_MAX = 500;

/**
 * The PUT body: every text field; category only when the note has one (an
 * empty category stays empty rather than becoming "note"); icon/colour only
 * when changed HERE, so an appearance set elsewhere (the list's menu) is never
 * put back by an editor that did not touch it.
 */
const patchOf = (s: Snapshot, base: Note | null): NotePatch => ({
  title: s.title,
  description: s.description,
  body: s.body,
  tags: s.tags,
  ...(s.category ? { category: s.category } : {}),
  ...(s.icon !== (base?.icon ?? "") ? { icon: s.icon } : {}),
  ...(s.color !== (base?.color ?? "") ? { color: s.color } : {}),
});

const sameContent = (a: Note, b: Note) =>
  a.title === b.title &&
  (a.description ?? "") === (b.description ?? "") &&
  (a.body ?? "") === (b.body ?? "") &&
  (a.category ?? "") === (b.category ?? "") &&
  a.tags.join("\u0000") === b.tags.join("\u0000");

/** The last rename request each tab has acted on. */
const renamedAt = new Map<string, number>();

/** Unsaved text of editors that unmounted before they could save (offline,
 *  conflict), restored when the tab is shown again. Session memory only. */
const stashed = new Map<string, { snap: Snapshot; base: Note | null }>();

// Every open editor's autosaver, so quitting the app can wait for pending
// saves: the main process calls window.__zekraFlushAll() on before-quit
// (src/main/main.ts) and gives it a few seconds before exiting.
const liveSavers = new Set<Autosaver<Snapshot>>();
(window as unknown as { __zekraFlushAll?: () => Promise<unknown> }).__zekraFlushAll = () =>
  Promise.allSettled([...liveSavers].map((s) => s.flush()));

/** Title and description as typed, before they are saved (live list rows/tabs). */
export type NoteDraft = { id: string | null; title: string; description: string };

export type NoteEditorProps = {
  tab: DeskTab;
  brain: Brain;
  token: string;
  /** Freshest copy the workspace knows (list/cache), if any. */
  cached: Note | null;
  focused: boolean;
  outlineHost: HTMLElement | null;
  /** The pane header's end (the group's tab strip): the note menu is
   *  portalled there, so the pane has one header row. */
  chromeHost?: HTMLElement | null;
  /** Bumped to focus and select the title (Rename: ⌘R / F2 / double-click). */
  rename?: number;
  onSaved: (tabKey: string, note: Note) => void;
  onCreated: (tabKey: string, note: Note) => void;
  onStatus: (tabKey: string, status: AutosaveStatus) => void;
  /** Every title/description keystroke, so the list row and tab follow live;
   *  null once the editor is gone (its last save is in the list by then). */
  onDraft?: (tabKey: string, draft: NoteDraft | null) => void;
  /** The "…" button: pops the note's native menu under `anchor`. */
  onMenu: (note: Note, anchor: Element) => void;
};

type View = "live" | "read" | "source";

export function NoteEditor(props: NoteEditorProps) {
  const { tab, brain, token, cached, focused, outlineHost, chromeHost, rename, onMenu } = props;
  const { t, dir } = useI18n();
  const { settings } = useNoteSettings();
  const canWrite = brain.canWrite;
  const latestProps = useRef(props);
  latestProps.current = props;

  // ── document state ─────────────────────────────────────────────────────
  const stash = stashed.get(tab.key);
  const baseRef = useRef<Note | null>(stash?.base ?? cached ?? null);
  const [base, setBase] = useState<Note | null>(baseRef.current);
  const init = stash?.snap ?? snapOf(cached);
  const snapRef = useRef<Snapshot>(init);
  const [title, setTitle] = useState(init.title);
  const [description, setDescription] = useState(init.description);
  const [body, setBody] = useState(init.body);
  const [tags, setTags] = useState(init.tags);
  const [category, setCategory] = useState(init.category);
  const [icon, setIcon] = useState(init.icon);
  const [color, setColor] = useState(init.color);
  const [loading, setLoading] = useState(Boolean(tab.id) && !stash && (!cached || cached.body === undefined));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>(stash ? "dirty" : "idle");
  const [saveError, setSaveError] = useState("");

  // The lossy check reads the body as LOADED (or as left in the source view),
  // not every keystroke: typing in the live editor must never flip the view.
  const [guardBody, setGuardBody] = useState(init.body);
  const lossy = useMemo(() => findLossyConstructs(guardBody), [guardBody]);
  const [source, setSource] = useState(false);
  const view: View = source ? "source" : lossy.length ? "read" : "live";
  const isSource = view === "source";

  const show = useCallback((s: Snapshot) => {
    setTitle(s.title);
    setDescription(s.description);
    setBody(s.body);
    setTags(s.tags);
    setCategory(s.category);
    setIcon(s.icon);
    setColor(s.color);
  }, []);

  const setAll = useCallback(
    (s: Snapshot) => {
      snapRef.current = s;
      show(s);
      setGuardBody(s.body);
      const p = latestProps.current;
      p.onDraft?.(p.tab.key, null);
    },
    [show],
  );

  const rebase = useCallback((n: Note) => {
    baseRef.current = n;
    setBase(n);
  }, []);

  // ── autosave ───────────────────────────────────────────────────────────
  const saverRef = useRef<Autosaver<Snapshot> | null>(null);
  const createdHere = useRef<string | null>(null);
  useEffect(() => {
    ensureFindStyles();
    const key = tab.key;
    const saver = new Autosaver<Snapshot>({
      delay: 800,
      onStatus: (s, err) => {
        setStatus(s);
        setSaveError(err);
        latestProps.current.onStatus(key, s);
      },
      save: async (snap) => {
        const p = latestProps.current;
        const b = baseRef.current;
        if (!b) {
          if (!snap.title.trim() && !snap.body.trim()) return { ok: true, skipped: true };
          try {
            let note = await notesApi.create(p.token, p.brain.namespace, {
              title: snap.title,
              description: snap.description,
              body: snap.body,
              tags: snap.tags,
              category: snap.category || "note",
            });
            createdHere.current = note.id;
            // POST ignores appearance: it follows as an update.
            if (snap.icon || snap.color) {
              const res = await saveNote(p.token, note, {
                ...(snap.icon ? { icon: snap.icon } : {}),
                ...(snap.color ? { color: snap.color } : {}),
              });
              if (res.ok) note = res.note;
            }
            rebase(note);
            p.onCreated(key, note);
            return { ok: true };
          } catch (e) {
            return { ok: false, conflict: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
        const res = await saveNote(p.token, b, patchOf(snap, b));
        if (!res.ok) return { ok: false, conflict: res.conflict, error: res.error };
        rebase(res.note);
        p.onSaved(key, res.note);
        return { ok: true };
      },
    });
    saverRef.current = saver;
    liveSavers.add(saver);
    if (stashed.has(key)) {
      stashed.delete(key);
      saver.change(snapRef.current); // resume what could not be saved last time
    }
    return () => {
      if (saverRef.current === saver) saverRef.current = null;
      liveSavers.delete(saver);
      // Tab switched or closed: save what is pending, keep it if that fails.
      void saver.flush().finally(() => {
        if (saver.isDirty) stashed.set(key, { snap: snapRef.current, base: baseRef.current });
        saver.dispose();
        latestProps.current.onStatus(key, "idle");
        if (!saver.isDirty) latestProps.current.onDraft?.(key, null);
      });
    };
  }, [tab.key, rebase]);

  const change = useCallback(
    (patch: Partial<Snapshot>) => {
      if (!canWrite) return;
      const next = { ...snapRef.current, ...patch };
      snapRef.current = next;
      if (patch.title !== undefined) setTitle(patch.title);
      if (patch.description !== undefined) setDescription(patch.description);
      if (patch.body !== undefined) setBody(patch.body);
      if (patch.tags !== undefined) setTags(patch.tags);
      if (patch.category !== undefined) setCategory(patch.category);
      if (patch.icon !== undefined) setIcon(patch.icon);
      if (patch.color !== undefined) setColor(patch.color);
      if (patch.title !== undefined || patch.description !== undefined) {
        const p = latestProps.current;
        p.onDraft?.(p.tab.key, { id: baseRef.current?.id ?? p.tab.id, title: next.title, description: next.description });
      }
      saverRef.current?.change(next);
    },
    [canWrite],
  );

  /** A newer server copy arrived (fresh fetch, list action, restore). */
  const adopt = useCallback(
    (n: Note) => {
      const b = baseRef.current;
      if (b && n.id !== b.id) return;
      if (b && n.version < b.version) return;
      if (b && sameContent(n, b)) {
        // Metadata only (pin, archive, appearance): keep any edits, and take
        // the new icon/colour unless this editor changed them itself.
        const s = snapRef.current;
        rebase(n);
        if (s.icon === (b.icon ?? "") && s.color === (b.color ?? "")) {
          const next = { ...s, icon: n.icon ?? "", color: n.color ?? "" };
          snapRef.current = next;
          setIcon(next.icon);
          setColor(next.color);
        }
        return;
      }
      if (saverRef.current?.isDirty) return; // editing: the save will surface the conflict
      rebase(n);
      setAll(snapOf(n));
    },
    [rebase, setAll],
  );

  // Fetch the newest copy when a saved note is shown (the list can lag) —
  // except right after this editor created it: that response IS the newest.
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!tab.id || fetchedFor.current === tab.id) return;
    fetchedFor.current = tab.id;
    if (createdHere.current === tab.id) return;
    let alive = true;
    notesApi
      .get(token, tab.id)
      .then((n) => {
        if (!alive) return;
        if (!baseRef.current) {
          rebase(n);
          setAll(snapOf(n));
        } else adopt(n);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setLoading(false);
        if (!baseRef.current) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      // StrictMode re-runs effects: let the second run fetch again.
      if (fetchedFor.current === tab.id) fetchedFor.current = null;
    };
  }, [tab.id, token, adopt, rebase, setAll]);

  useEffect(() => {
    if (cached && tab.id && cached.id === tab.id) adopt(cached);
  }, [cached, tab.id, adopt]);

  const flush = useCallback(() => void saverRef.current?.flush(), []);

  async function reloadTheirs() {
    if (!baseRef.current) return;
    try {
      const n = await notesApi.get(token, baseRef.current.id);
      rebase(n);
      setAll(snapOf(n));
      saverRef.current?.resolved({ dirty: false });
      props.onSaved(tab.key, n);
    } catch (e) {
      toast.error(t("editor.actionFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function overwrite() {
    if (!baseRef.current) return;
    try {
      const n = await overwriteNote(token, baseRef.current.id, patchOf(snapRef.current, baseRef.current));
      rebase(n);
      saverRef.current?.resolved({ dirty: false });
      props.onSaved(tab.key, n);
    } catch (e) {
      toast.error(t("editor.actionFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  // Save on blur (focus leaving the editor pane altogether).
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    flush();
  };
  useEffect(() => {
    const onUnload = () => flush();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [flush]);

  // ── panes ──────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const liveRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  useAuthedImagesIn(liveRef, `${view}:${loading}`);
  useAuthedImagesIn(previewRef, `${view}:${loading}`);

  const focusTitle = useCallback((select: boolean) => {
    const el = titleRef.current;
    if (!el) return;
    el.focus();
    if (select) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const focusBody = useCallback(() => {
    if (view === "source") taRef.current?.focus();
    else (liveRef.current?.querySelector(".ProseMirror") as HTMLElement | null)?.focus();
  }, [view]);

  // New, empty note: start in the title.
  useEffect(() => {
    if (!tab.id && focused) titleRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rename (⌘R / F2 / double-click in the list): the title, selected. Each
  // request once — not again when the tab is shown later.
  useEffect(() => {
    if (!rename || !canWrite || renamedAt.get(tab.key) === rename) return;
    renamedAt.set(tab.key, rename);
    focusTitle(true);
  }, [rename, canWrite, focusTitle, tab.key]);
  useCommand("note:rename", () => (canWrite ? focusTitle(true) : false), focused);

  // View Markdown Source: in place of the body, until Done.
  const toggleSource = useCallback(() => {
    setSource((on) => {
      if (on) setGuardBody(snapRef.current.body); // back to live: re-check what was written
      return !on;
    });
  }, []);
  useCommand("note:view-source", () => toggleSource(), focused);

  const domPane = () => (view === "live" ? liveRef.current : view === "read" ? previewRef.current : null);

  // Source-view image paste / drop: upload, then insert markdown at the caret.
  async function insertImages(files: File[]) {
    const ta = taRef.current;
    if (!ta || !files.length || !canWrite) return;
    const id = toast.loading(t("editor.uploading"));
    try {
      let snippet = "";
      for (const f of files) {
        const { url } = await uploadNoteImage(token, f, brain.namespace);
        snippet += `![${f.name.replace(/[[\]]/g, "")}](${url})\n`;
      }
      const cur = snapRef.current.body;
      const at = ta.selectionStart ?? cur.length;
      change({ body: cur.slice(0, at) + snippet + cur.slice(ta.selectionEnd ?? at) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      toast.dismiss(id);
    }
  }
  const onSourcePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFrom(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    void insertImages(files);
  };
  const onSourceDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFrom(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    void insertImages(files);
  };

  // ── cursor (source) ────────────────────────────────────────────────────
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const trackCursor = () => {
    const ta = taRef.current;
    if (ta) setCursor(lineCol(ta.value, ta.selectionStart ?? 0));
  };
  useEffect(() => {
    if (!isSource) setCursor(null);
  }, [isSource]);

  // ── outline ────────────────────────────────────────────────────────────
  const deferredBody = useDeferredValue(body);
  const showOutline = focused && !!outlineHost;
  const outline = useMemo(() => (showOutline ? outlineOf(deferredBody) : []), [showOutline, deferredBody]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const recomputeActive = useCallback(() => {
    if (!showOutline) return;
    if (isSource) {
      const line = cursor?.line ?? 1;
      let a = -1;
      for (const it of outline) if (it.line <= line) a = it.index;
      setActiveIdx(a);
      return;
    }
    const pane = view === "live" ? liveRef.current : previewRef.current;
    const scroller = scrollRef.current;
    if (pane && scroller) setActiveIdx(activeHeading(pane, scroller));
  }, [showOutline, isSource, view, cursor, outline]);
  useEffect(() => recomputeActive(), [recomputeActive, deferredBody]);

  function pickHeading(it: OutlineItem) {
    if (isSource) {
      const ta = taRef.current;
      if (ta) revealInTextarea(ta, it.offset, it.offset, true);
      trackCursor();
    } else {
      const pane = domPane();
      const h = pane ? headingElements(pane)[it.index] : undefined;
      h?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    setActiveIdx(it.index);
  }

  // ── find ───────────────────────────────────────────────────────────────
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const findInput = useRef<HTMLInputElement | null>(null);
  const ranges = useRef<Range[]>([]);
  const offsets = useRef<number[]>([]);

  const reveal = useCallback(
    (i: number) => {
      if (isSource) {
        const at = offsets.current[i];
        const ta = taRef.current;
        if (ta && at !== undefined) revealInTextarea(ta, at, at + findQ.length);
        return;
      }
      paintHighlights(ranges.current, i);
      const r = ranges.current[i];
      if (r) scrollRangeIntoView(r);
    },
    [isSource, findQ],
  );

  useEffect(() => {
    if (!findOpen || !focused) {
      clearHighlights();
      return;
    }
    const timer = setTimeout(() => {
      offsets.current = isSource ? textMatches(snapRef.current.body, findQ) : [];
      const pane = domPane();
      ranges.current = pane && !isSource ? domMatches(pane, findQ) : [];
      const count = isSource ? offsets.current.length : ranges.current.length;
      setFindCount(count);
      const idx = Math.min(findIdx, Math.max(0, count - 1));
      if (idx !== findIdx) setFindIdx(idx);
      if (!isSource) paintHighlights(ranges.current, idx);
      else clearHighlights();
    }, 120);
    return () => clearTimeout(timer);
  }, [findOpen, focused, findQ, body, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearHighlights(), []);

  const step = (delta: 1 | -1) => {
    if (!findCount) return;
    const i = (findIdx + delta + findCount) % findCount;
    setFindIdx(i);
    reveal(i);
  };
  const closeFind = () => {
    setFindOpen(false);
    clearHighlights();
    focusBody();
  };

  // ── commands (only while this group is focused) ───────────────────────
  useCommand("find", () => {
    setFindOpen(true);
    setTimeout(() => {
      findInput.current?.focus();
      findInput.current?.select();
    }, 0);
  }, focused);
  useCommand("save", () => flush(), focused);
  const exportAs = (format: ExportFormat) => () => {
    const snap = snapRef.current;
    const id = toast.loading(t("editor.exporting", { format: format.toUpperCase() }));
    void exportNote({ title: snap.title, body: snap.body }, format, { dir })
      .then((res) => {
        toast.dismiss(id);
        if (!res.canceled) toast.success(t("ws.exported", { name: (res.path ?? "").split(/[\\/]/).pop() || format }));
      })
      .catch((e: unknown) => {
        toast.dismiss(id);
        toast.error(t("editor.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
      });
  };
  useCommand("export:md", exportAs("md"), focused);
  useCommand("export:html", exportAs("html"), focused);
  useCommand("export:pdf", exportAs("pdf"), focused);
  useCommand("export:docx", exportAs("docx"), focused);
  useCommand("export:png", exportAs("png"), focused);
  useCommand("export:txt", exportAs("txt"), focused);

  // ── status bar ─────────────────────────────────────────────────────────
  const stats = useMemo(() => textStats(deferredBody), [deferredBody]);
  const saveLabel = !canWrite
    ? t("ws.status.readOnly")
    : status === "saving"
      ? t("ws.status.saving")
      : status === "dirty"
        ? t("ws.status.unsaved")
        : status === "conflict"
          ? t("ws.status.conflict")
          : status === "error"
            ? t("ws.status.error")
            : base
              ? t("ws.status.saved")
              : "";
  const saveTone =
    status === "conflict" || status === "error"
      ? "text-destructive"
      : status === "dirty"
        ? "text-grid-gold"
        : status === "saving"
          ? "text-grid-action"
          : "";
  useSlot(
    "statusbar.end",
    focused ? (
      <span className="flex items-center gap-3 tabular-nums">
        <span>{t("ws.status.words", { n: stats.words.toLocaleString() })}</span>
        <span>{t("ws.status.chars", { n: stats.chars.toLocaleString() })}</span>
        {cursor ? <span>{t("ws.status.cursor", { line: cursor.line, col: cursor.col })}</span> : null}
        {saveLabel ? (
          <span className={cn("flex items-center gap-1.5", saveTone)} title={saveError || undefined}>
            <span aria-hidden className="size-1.5 rounded-full bg-current opacity-80" />
            {saveLabel}
          </span>
        ) : null}
      </span>
    ) : null,
    { order: 10 },
  );

  // ── render ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-sm">
        <p className="text-destructive">{t("ws.loadFailed")}</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  const readerFont = { fontSize: `${Math.max(11, settings.fontSize - 2)}px` };
  const appearance = { icon, color, category };
  const tile = <NoteIconTile note={appearance} className="size-9 rounded-lg" iconClassName="size-[18px]" />;

  const header = (
    <div className="shrink-0 px-10 pt-6 pb-3 xl:px-14">
      <div className="flex items-start gap-3">
        {/* Icon + colour, on the start side of the title. */}
        {canWrite ? (
          <Popover>
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={t("ws.icon.change")}
                  title={t("ws.icon.change")}
                  className="mt-0.5 shrink-0 rounded-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              {tile}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-3">
              <AppearancePicker
                icon={icon}
                color={color}
                category={category}
                onChange={(patch) => change({ ...(patch.icon !== undefined ? { icon: patch.icon } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) })}
              />
            </PopoverContent>
          </Popover>
        ) : (
          <span className="mt-0.5">{tile}</span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            readOnly={!canWrite}
            dir="auto"
            placeholder={t("editor.titlePlaceholder")}
            aria-label={t("editor.titlePlaceholder")}
            onChange={(e) => change({ title: e.target.value.replace(/\n/g, " ") })}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "Enter") {
                e.preventDefault();
                descRef.current?.focus();
              } else if (e.key === "ArrowDown" && el.selectionStart === el.value.length) {
                e.preventDefault();
                descRef.current?.focus();
              }
            }}
            className="zk-bidi field-sizing-content w-full resize-none bg-transparent text-[26px] leading-tight font-bold tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/50 rtl:tracking-normal"
          />
          {canWrite || description ? (
            <textarea
              ref={descRef}
              rows={1}
              value={description}
              readOnly={!canWrite}
              dir="auto"
              maxLength={DESCRIPTION_MAX}
              placeholder={t("editor.descriptionPlaceholder")}
              aria-label={t("editor.descriptionLabel")}
              onChange={(e) => change({ description: e.target.value.replace(/\n/g, " ") })}
              onKeyDown={(e) => {
                const el = e.currentTarget;
                if (e.key === "Enter") {
                  e.preventDefault();
                  focusBody();
                } else if ((e.key === "Backspace" && !el.value) || (e.key === "ArrowUp" && el.selectionStart === 0 && el.selectionEnd === 0)) {
                  e.preventDefault();
                  focusTitle(false);
                }
              }}
              className="zk-bidi field-sizing-content max-h-[3lh] w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-snug text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            />
          ) : null}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 ps-12">
        <CategoryPicker value={category} readOnly={!canWrite} onChange={(c) => change({ category: c })} />
        <TagEditor namespace={brain.namespace} token={token} tags={tags} readOnly={!canWrite} onChange={(tg) => change({ tags: tg })} />
        <span className="ms-auto truncate text-[12.5px] text-muted-foreground">
          {base ? t("notes.x.version", { n: base.version }) : canWrite ? t("ws.draftHint") : null}
          {base && !canWrite ? <span className="ms-2">· {t("editor.readOnly")}</span> : null}
        </span>
      </div>
    </div>
  );

  const lossyWhat = lossy
    .map((l) => t(l.kind === "footnote" ? "ws.lossy.footnote" : "ws.lossy.html"))
    .join(t("ws.lossy.and"));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" onBlur={onBlur}>
      {chromeHost && base
        ? createPortal(
            <IconButton label={t("notes.x.more")} onClick={(e) => onMenu(base, e.currentTarget)}>
              <Ellipsis />
            </IconButton>,
            chromeHost,
          )
        : null}

      {findOpen ? (
        <FindBar
          ref={findInput}
          query={findQ}
          onQuery={(q) => {
            setFindQ(q);
            setFindIdx(0);
          }}
          count={findCount}
          index={findIdx}
          onNext={() => step(1)}
          onPrev={() => step(-1)}
          onClose={closeFind}
        />
      ) : null}

      {status === "conflict" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-muted/60 px-4 py-2 text-[14px]">
          <TriangleAlert className="size-4 shrink-0 text-grid-warn" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{t("editor.conflictTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("editor.conflictBody")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void reloadTheirs()}>
            {t("editor.reloadTheirs")}
          </Button>
          <Button size="sm" onClick={() => void overwrite()}>
            {t("editor.overwrite")}
          </Button>
        </div>
      ) : status === "error" && saveError ? (
        <div role="alert" className="border-b border-border/60 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {t("editor.saveFailed", { error: saveError })}
        </div>
      ) : null}

      {isSource ? (
        // The markdown source: a secondary view in place of the body.
        <div className="flex min-h-0 flex-1 flex-col">
          {header}
          <div className="app-chrome flex shrink-0 items-center gap-2 border-y border-border/60 bg-muted/40 px-10 py-1 text-xs text-muted-foreground xl:px-14">
            <Code2 className="size-3.5" />
            <span className="flex-1">{t("ws.source.title")}</span>
            <Button size="xs" variant="ghost" onClick={toggleSource}>
              {t("ws.source.done")}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <textarea
              ref={taRef}
              value={body}
              readOnly={!canWrite}
              spellCheck={false}
              wrap={settings.wordWrap ? "soft" : "off"}
              dir="auto"
              placeholder={t("editor.placeholder")}
              onChange={(e) => {
                change({ body: e.target.value });
                trackCursor();
              }}
              onSelect={trackCursor}
              onKeyUp={trackCursor}
              onClick={trackCursor}
              onFocus={trackCursor}
              onPaste={onSourcePaste}
              onDrop={onSourceDrop}
              style={readerFont}
              className="zk-source zk-bidi h-full w-full resize-none bg-transparent px-10 py-5 font-mono leading-6 text-foreground outline-none placeholder:text-muted-foreground xl:px-14"
            />
          </div>
        </div>
      ) : (
        // One scrolling page: header and body move together, as in Notes.
        <div ref={scrollRef} onScroll={recomputeActive} className="min-h-0 flex-1 overflow-y-auto">
          {header}
          {loading ? (
            <div className="space-y-3 px-10 py-4 xl:px-14" aria-busy>
              {[90, 75, 82, 60, 70].map((w, i) => (
                <Skeleton key={i} className="h-3.5 rounded-sm" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : view === "live" ? (
            <div
              ref={liveRef}
              className="zk-live px-10 pt-1 pb-24 xl:px-14"
              // Click below the text: carry on typing at its end.
              onMouseDown={(e) => {
                if (!canWrite || e.target !== e.currentTarget) return;
                e.preventDefault();
                const pm = liveRef.current?.querySelector(".ProseMirror") as HTMLElement | null;
                if (!pm) return;
                pm.focus();
                const sel = window.getSelection();
                sel?.selectAllChildren(pm);
                sel?.collapseToEnd();
              }}
            >
              <NoteEditorWysiwyg
                value={body}
                namespace={brain.namespace}
                editable={canWrite}
                onChange={(md) => change({ body: md })}
                uploadImage={(file, ns) => uploadNoteImage(token, file, ns)}
              />
            </div>
          ) : (
            // Markdown the live editor cannot keep: shown as written.
            <div ref={previewRef} className="zk-reader px-10 pt-1 pb-24 xl:px-14 [&>div]:mx-auto">
              <div role="note" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">{t("ws.lossy.body", { what: lossyWhat })}</span>
                {canWrite ? (
                  <Button size="xs" variant="outline" onClick={toggleSource}>
                    {t("ws.lossy.edit")}
                  </Button>
                ) : null}
              </div>
              {body.trim() ? <Markdown text={body} /> : null}
            </div>
          )}
        </div>
      )}

      {showOutline && outlineHost
        ? createPortal(<OutlineRail items={outline} active={activeIdx} onPick={pickHeading} />, outlineHost)
        : null}
    </div>
  );
}
