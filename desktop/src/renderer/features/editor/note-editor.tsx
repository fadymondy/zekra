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
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Ellipsis, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NoteEditorWysiwyg } from "@/components/notes/note-editor-wysiwyg";
import { useNoteSettings } from "@/components/notes/note-settings-panel";
import { imageFilesFrom } from "@/lib/notes/upload-image";
import { cn } from "@/lib/utils";

import { Autosaver, type AutosaveStatus } from "@mobile/features/editor/autosave-core";

import { Markdown } from "../../components/markdown";
import type { Brain, Note } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useCommand } from "../../shell/commands";
import { useSlot } from "../../shell/slots";
import { toast } from "../../shell/toast";
import { notesApi, overwriteNote, saveNote } from "../notes/notes-api";
import { textStats } from "../notes/notes-model";
import { uploadNoteImage, useAuthedImagesIn } from "./authed-dom-images";
import { FindBar, ModeSwitch, OutlineRail, SplitDivider, type EditorMode } from "./editor-chrome";
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
One open note: title, tags + category, and the body in one of four modes —

  live     the web's TipTap WYSIWYG (NoteEditorWysiwyg), the default: you edit
           the rendered note, Apple Notes style
  source   the markdown in a plain textarea, in the house mono
  split    source and a live preview side by side (Mark It Down's Split),
           draggable divider, the preview following the source's scroll
  preview  the rendered note (NoteMarkdown), read-only

Saving is mobile's autosave (autosave-core.ts): 800 ms after the last change,
and at once on blur, on ⌘S, when the tab is switched or closed (unmount). A
new note (tab.id null) is created by its FIRST save — the server rejects empty
notes, so an untouched draft never reaches it. A 409 stops autosave and shows
the conflict banner: Reload theirs / Overwrite.

While its group is focused the editor also owns: the status-bar items (words,
characters, cursor in source, save state), ⌘F find, ⌘S save, the File ▸ Export
commands, and the outline rail (portalled into the workspace's rail).
*/

type Snapshot = { title: string; body: string; tags: string[]; category: string };

const snapOf = (n: Note | null | undefined): Snapshot => ({
  title: n?.title ?? "",
  body: n?.body ?? "",
  tags: n?.tags ?? [],
  category: n?.category ?? "",
});

/** The PUT body: every editable field, category only when the note has one
 *  (an empty category stays empty rather than becoming "note"). */
const patchOf = (s: Snapshot) => ({ title: s.title, body: s.body, tags: s.tags, ...(s.category ? { category: s.category } : {}) });

const sameContent = (a: Note, b: Note) =>
  a.title === b.title &&
  (a.body ?? "") === (b.body ?? "") &&
  (a.category ?? "") === (b.category ?? "") &&
  a.tags.join("\u0000") === b.tags.join("\u0000");

/** Unsaved text of editors that unmounted before they could save (offline,
 *  conflict), restored when the tab is shown again. Session memory only. */
const stashed = new Map<string, { snap: Snapshot; base: Note | null }>();

const SPLIT_KEY = "zekra.desktop.source-split";


// Every open editor's autosaver, so quitting the app can wait for pending
// saves: the main process calls window.__zekraFlushAll() on before-quit
// (src/main/main.ts) and gives it a few seconds before exiting.
const liveSavers = new Set<Autosaver<Snapshot>>();
(window as unknown as { __zekraFlushAll?: () => Promise<unknown> }).__zekraFlushAll = () =>
  Promise.allSettled([...liveSavers].map((s) => s.flush()));

export type NoteEditorProps = {
  tab: DeskTab;
  brain: Brain;
  token: string;
  /** Freshest copy the workspace knows (list/cache), if any. */
  cached: Note | null;
  focused: boolean;
  mode: EditorMode;
  onModeChange: (m: EditorMode) => void;
  outlineHost: HTMLElement | null;
  onSaved: (tabKey: string, note: Note) => void;
  onCreated: (tabKey: string, note: Note) => void;
  onStatus: (tabKey: string, status: AutosaveStatus) => void;
  /** Dropdown items for the "…" menu of a saved note. */
  menu: (note: Note) => ReactNode;
};

export function NoteEditor(props: NoteEditorProps) {
  const { tab, brain, token, cached, focused, mode, onModeChange, outlineHost, menu } = props;
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
  const [body, setBody] = useState(init.body);
  const [tags, setTags] = useState(init.tags);
  const [category, setCategory] = useState(init.category);
  const [loading, setLoading] = useState(Boolean(tab.id) && !stash && (!cached || cached.body === undefined));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>(stash ? "dirty" : "idle");
  const [saveError, setSaveError] = useState("");

  const setAll = useCallback((s: Snapshot) => {
    snapRef.current = s;
    setTitle(s.title);
    setBody(s.body);
    setTags(s.tags);
    setCategory(s.category);
  }, []);

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
            const note = await notesApi.create(p.token, p.brain.namespace, {
              title: snap.title,
              body: snap.body,
              tags: snap.tags,
              category: snap.category || "note",
            });
            createdHere.current = note.id;
            rebase(note);
            p.onCreated(key, note);
            return { ok: true };
          } catch (e) {
            return { ok: false, conflict: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
        const res = await saveNote(p.token, b, patchOf(snap));
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
      });
    };
  }, [tab.key, rebase]);

  const change = useCallback(
    (patch: Partial<Snapshot>) => {
      if (!canWrite) return;
      const next = { ...snapRef.current, ...patch };
      snapRef.current = next;
      if (patch.title !== undefined) setTitle(patch.title);
      if (patch.body !== undefined) setBody(patch.body);
      if (patch.tags !== undefined) setTags(patch.tags);
      if (patch.category !== undefined) setCategory(patch.category);
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
        rebase(n); // metadata only (pin, archive, appearance): keep any edits
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
      const n = await overwriteNote(token, baseRef.current.id, patchOf(snapRef.current));
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
  const liveRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const [splitRatio, setSplitRatio] = useState(() => {
    const n = Number(localStorage.getItem(SPLIT_KEY));
    return n >= 0.15 && n <= 0.85 ? n : 0.5;
  });
  useAuthedImagesIn(liveRef, `${mode}:${loading}`);
  useAuthedImagesIn(previewRef, `${mode}:${loading}`);

  // New, empty note: start in the title.
  useEffect(() => {
    if (!tab.id && focused) titleRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const domPane = () => (mode === "live" ? liveRef.current : mode === "source" ? null : previewRef.current);

  // Source-mode image paste / drop: upload, then insert markdown at the caret.
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
    if (mode !== "source" && mode !== "split") setCursor(null);
  }, [mode]);

  // Split: the preview follows the source's scroll position.
  const onSourceScroll = () => {
    if (mode !== "split") return;
    const ta = taRef.current;
    const pv = previewRef.current;
    if (!ta || !pv) return;
    const max = ta.scrollHeight - ta.clientHeight;
    pv.scrollTop = max > 0 ? (ta.scrollTop / max) * (pv.scrollHeight - pv.clientHeight) : 0;
  };

  // ── outline ────────────────────────────────────────────────────────────
  const deferredBody = useDeferredValue(body);
  const showOutline = focused && !!outlineHost;
  const outline = useMemo(() => (showOutline ? outlineOf(deferredBody) : []), [showOutline, deferredBody]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const recomputeActive = useCallback(() => {
    if (!showOutline) return;
    if (mode === "source") {
      const line = cursor?.line ?? 1;
      let a = -1;
      for (const it of outline) if (it.line <= line) a = it.index;
      setActiveIdx(a);
      return;
    }
    const pane = mode === "live" ? liveRef.current : previewRef.current;
    if (pane) setActiveIdx(activeHeading(pane, pane));
  }, [showOutline, mode, cursor, outline]);
  useEffect(() => recomputeActive(), [recomputeActive, deferredBody]);

  function pickHeading(it: OutlineItem) {
    if (mode === "source" || mode === "split") {
      const ta = taRef.current;
      if (ta) revealInTextarea(ta, it.offset, it.offset, true);
      trackCursor();
    }
    if (mode !== "source") {
      const pane = mode === "live" ? liveRef.current : previewRef.current;
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
      if (mode === "source" || mode === "split") {
        const at = offsets.current[i];
        const ta = taRef.current;
        if (ta && at !== undefined) revealInTextarea(ta, at, at + findQ.length);
      }
      if (mode !== "source") {
        paintHighlights(ranges.current, i);
        const r = ranges.current[i];
        if (r) scrollRangeIntoView(r);
      }
    },
    [mode, findQ],
  );

  useEffect(() => {
    if (!findOpen || !focused) {
      clearHighlights();
      return;
    }
    const timer = setTimeout(() => {
      offsets.current = mode === "source" || mode === "split" ? textMatches(snapRef.current.body, findQ) : [];
      const pane = domPane();
      ranges.current = pane && mode !== "source" ? domMatches(pane, findQ) : [];
      const count = mode === "source" || mode === "split" ? offsets.current.length : ranges.current.length;
      setFindCount(count);
      const idx = Math.min(findIdx, Math.max(0, count - 1));
      if (idx !== findIdx) setFindIdx(idx);
      if (mode !== "source") paintHighlights(ranges.current, idx);
    }, 120);
    return () => clearTimeout(timer);
  }, [findOpen, focused, findQ, body, mode]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (mode === "source" || mode === "split") taRef.current?.focus();
    else (liveRef.current?.querySelector(".ProseMirror") as HTMLElement | null)?.focus();
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
      ? "text-grid-danger"
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
          <span className={cn("font-mono tracking-wider uppercase", saveTone)} title={saveError || undefined}>
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
        <p className="text-grid-danger">{t("ws.loadFailed")}</p>
        <p className="text-xs text-grid-muted">{loadError}</p>
      </div>
    );
  }

  const readerFont = { fontSize: `${Math.max(11, settings.fontSize - 2)}px` };
  const source = (
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
      onScroll={onSourceScroll}
      onPaste={onSourcePaste}
      onDrop={onSourceDrop}
      style={readerFont}
      className="zk-source h-full w-full resize-none bg-transparent px-8 py-5 font-mono leading-6 text-grid-fg outline-none placeholder:text-grid-muted"
    />
  );
  const preview = (
    <div ref={previewRef} onScroll={recomputeActive} className="h-full min-h-0 overflow-y-auto px-8 py-5 [&>div]:mx-auto">
      {body.trim() ? <Markdown text={body} /> : <p className="text-sm text-grid-muted">{t("editor.placeholder")}</p>}
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-grid-bg" onBlur={onBlur}>
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <div className="min-w-0 flex-1 truncate text-[11px] text-grid-muted">
          {base ? (
            <span dir="ltr" className="font-mono">
              {t("notes.x.version", { n: base.version })}
            </span>
          ) : canWrite ? (
            t("ws.draftHint")
          ) : null}
          {base && !canWrite ? <span className="ms-2">· {t("editor.readOnly")}</span> : null}
        </div>
        <ModeSwitch mode={mode} onChange={onModeChange} />
        {base ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("notes.x.more")} title={t("notes.x.more")} />}>
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              {menu(base)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

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
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-grid-gold/40 bg-grid-gold/10 px-4 py-2 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-grid-gold" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-grid-fg">{t("editor.conflictTitle")}</p>
            <p className="text-xs text-grid-muted">{t("editor.conflictBody")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void reloadTheirs()}>
            {t("editor.reloadTheirs")}
          </Button>
          <Button size="sm" onClick={() => void overwrite()}>
            {t("editor.overwrite")}
          </Button>
        </div>
      ) : status === "error" && saveError ? (
        <div role="alert" className="border-b border-line bg-grid-danger/10 px-4 py-1.5 text-xs text-grid-danger">
          {t("editor.saveFailed", { error: saveError })}
        </div>
      ) : null}

      {/* Title + meta */}
      <div className="shrink-0 px-8 pt-5 pb-3">
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
            if (e.key === "Enter") {
              e.preventDefault();
              if (mode === "live") (liveRef.current?.querySelector(".ProseMirror") as HTMLElement | null)?.focus();
              else taRef.current?.focus();
            }
          }}
          className="field-sizing-content w-full resize-none bg-transparent text-2xl leading-tight font-medium text-grid-fg outline-none placeholder:text-grid-muted/70"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CategoryPicker value={category} readOnly={!canWrite} onChange={(c) => change({ category: c })} />
          <TagEditor namespace={brain.namespace} token={token} tags={tags} readOnly={!canWrite} onChange={(tg) => change({ tags: tg })} />
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-3 px-8 py-4" aria-busy>
          {[90, 75, 82, 60, 70].map((w, i) => (
            <div key={i} className="h-3.5 animate-pulse rounded bg-grid-soft" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : mode === "live" ? (
        <div ref={liveRef} onScroll={recomputeActive} className="zk-live min-h-0 flex-1 overflow-y-auto px-8 pt-1 pb-24">
          <NoteEditorWysiwyg
            value={body}
            namespace={brain.namespace}
            editable={canWrite}
            onChange={(md) => change({ body: md })}
            uploadImage={(file, ns) => uploadNoteImage(token, file, ns)}
          />
        </div>
      ) : mode === "source" ? (
        <div className="min-h-0 flex-1">{source}</div>
      ) : mode === "split" ? (
        <div ref={splitRef} className="flex min-h-0 flex-1 border-t border-line">
          <div className="min-w-0" style={{ flexBasis: `${splitRatio * 100}%`, flexGrow: 0, flexShrink: 0 }}>
            {source}
          </div>
          <SplitDivider
            container={() => splitRef.current}
            onRatio={setSplitRatio}
            onDone={() => localStorage.setItem(SPLIT_KEY, String(splitRatio))}
          />
          <div className="min-w-0 flex-1 bg-grid-card/40">{preview}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">{preview}</div>
      )}

      {showOutline && outlineHost
        ? createPortal(<OutlineRail items={outline} active={activeIdx} onPick={pickHeading} />, outlineHost)
        : null}
    </div>
  );
}
