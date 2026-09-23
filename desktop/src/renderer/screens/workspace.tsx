import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Columns2, FilePlus2, ListTree, NotebookPen, PanelLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { forgetRecent, pushRecent } from "@/lib/notes/recent-notes";
import { cn } from "@/lib/utils";

import type { AutosaveStatus } from "@mobile/features/editor/autosave-core";

import { Spotlight, type SpotlightCommand } from "../components/spotlight";
import type { OpenHow } from "../components/note-row";
import { NoteTree } from "../components/note-tree";
import { SplitDivider, loadMode, saveMode, type EditorMode } from "../features/editor/editor-chrome";
import { NoteEditor } from "../features/editor/note-editor";
import { ReadingTheme } from "../features/editor/reading-theme";
import {
  activeTab,
  closeTab,
  cycleTab,
  draftKey,
  dropNote,
  loadLayout,
  locate,
  moveTab,
  openTab,
  patchTab,
  saveLayout,
  selectTab,
  split,
  unsplit,
  type DeskTab,
  type Layout,
} from "../features/editor/tab-groups";
import { TabStrip, type DroppedNote } from "../features/editor/tab-strip";
import { NoteMenuItems } from "../features/notes/note-menu";
import { notesApi } from "../features/notes/notes-api";
import type { NoteFilter, NoteSort } from "../features/notes/notes-model";
import { NotesSidebar } from "../features/notes/notes-sidebar";
import { useNoteActions } from "../features/notes/use-note-actions";
import { useNotesList } from "../features/notes/use-notes-list";
import type { Brain, Note } from "../lib/api";
import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { useCommand } from "../shell/commands";
import { useRouter } from "../shell/router";
import { toast } from "../shell/toast";

/*
The brain route's Notes tab (MH-450) — three panes:

  ┌ sidebar ─────┬ group 0 tabs ────────┬ group 1 tabs (split) ┬ outline ┐
  │ filter       │                      │                      │ h1      │
  │ All|Pin|Arch │   NoteEditor         │   NoteEditor         │   h2    │
  │ rows…        │                      │                      │         │
  └──────────────┴──────────────────────┴──────────────────────┴─────────┘

Tabs live in one or two groups (features/editor/tab-groups.ts), persisted per
brain; the focused group owns the editor commands. The sidebar list and the
editors share one freshest-copy cache, so an action on a row and the open
editor never write from different versions.

Commands owned while mounted:
  new-note ⌘N · close-tab ⌘W · reopen-tab ⇧⌘T · next/prev-tab ⌥⌘→/←
  toggle-sidebar ⌘\ · toggle-outline ⇧⌘L · spotlight ⌘K (via <Spotlight>)
The focused editor adds find ⌘F, save ⌘S and File ▸ Export.
*/

const PREFS = "zekra.desktop.workspace";
type Prefs = { sidebar: boolean; outline: boolean; filter: NoteFilter; sort: NoteSort };
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>;
    return {
      sidebar: p.sidebar ?? true,
      outline: p.outline ?? true,
      filter: p.filter === "pinned" || p.filter === "archived" ? p.filter : "all",
      sort: p.sort === "created" || p.sort === "title" ? p.sort : "updated",
    };
  } catch {
    return { sidebar: true, outline: true, filter: "all", sort: "updated" };
  }
}

const DIRTY: AutosaveStatus[] = ["dirty", "saving", "conflict", "error"];

const tabOf = (n: Pick<Note, "id" | "title" | "category" | "icon" | "color">): DeskTab => ({
  key: n.id,
  id: n.id,
  title: n.title,
  ...(n.category ? { category: n.category } : {}),
  ...(n.icon ? { icon: n.icon } : {}),
  ...(n.color ? { color: n.color } : {}),
});

export function Workspace({ token, brain, initialNoteId, onDirtyChange }: {
  token: string;
  brain: Brain;
  /** Open this note (the brain route's noteId: deep links, spotlight). */
  initialNoteId?: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const ns = brain.namespace;

  // ── layout & prefs ─────────────────────────────────────────────────────
  const [layout, setLayout] = useState<Layout>(() => loadLayout(ns));
  useEffect(() => saveLayout(ns, layout), [ns, layout]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [k]: v };
      try {
        localStorage.setItem(PREFS, JSON.stringify(next));
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);
  const [mode, setModeState] = useState<EditorMode>(loadMode);
  const setMode = useCallback((m: EditorMode) => {
    setModeState(m);
    saveMode(m);
  }, []);
  const closed = useRef<DeskTab[]>([]);
  const [outlineHost, setOutlineHost] = useState<HTMLElement | null>(null);
  const groupsRef = useRef<HTMLElement | null>(null);

  // ── notes list ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [serverQ, setServerQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setServerQ(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  const view = useMemo(() => ({ filter: prefs.filter, sort: prefs.sort, q: serverQ }), [prefs.filter, prefs.sort, serverQ]);
  const list = useNotesList(token, ns, view);

  // Freshest copy of every note we have touched (editor saves, row actions).
  const [cache, setCache] = useState<Record<string, Note>>({});
  const remember = useCallback((n: Note) => {
    setCache((c) => (c[n.id] && c[n.id].version > n.version ? c : { ...c, [n.id]: n }));
  }, []);
  const noteFor = useCallback(
    (id: string | null): Note | null => {
      if (!id) return null;
      const a = cache[id];
      const b = list.notes.find((n) => n.id === id);
      if (a && b) return a.version >= b.version ? a : b;
      return a ?? b ?? null;
    },
    [cache, list.notes],
  );
  const latest = useCallback((n: Note) => {
    const c = noteFor(n.id);
    return c && c.version >= n.version ? c : n;
  }, [noteFor]);

  // ── dirty tracking (tab dots + the window's edited dot) ────────────────
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const onStatus = useCallback((key: string, s: AutosaveStatus) => {
    setDirty((d) => {
      const has = d.has(key);
      const want = DIRTY.includes(s);
      if (has === want) return d;
      const next = new Set(d);
      if (want) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => {
    onDirtyChange?.(dirty.size > 0);
    void bridge().setDocumentEdited(dirty.size > 0);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => void bridge().setDocumentEdited(false), []);

  // ── opening / closing ──────────────────────────────────────────────────
  const open = useCallback(
    (n: Pick<Note, "id" | "title" | "category" | "icon" | "color">, how: OpenHow = "open", group?: number) => {
      if ("version" in n) remember(n as Note);
      pushRecent({ id: n.id, namespace: ns, title: n.title, category: n.category });
      setLayout((l) => {
        if (how === "open-side") {
          // Already split: open in the other group. Otherwise split with it.
          if (l.groups.length > 1) {
            const at = locate(l, n.id);
            const to = l.focus === 0 ? 1 : 0;
            return at ? moveTab(l, at.tab.key, to, null) : openTab(l, tabOf(n), { newTab: true, group: to });
          }
          const withTab = openTab(l, tabOf(n), { newTab: true });
          return split(withTab, withTab.groups[withTab.focus].active ?? undefined);
        }
        return openTab(l, tabOf(n), { newTab: how === "open-new-tab", group });
      });
    },
    [ns, remember],
  );

  const openById = useCallback(
    async (id: string, how: OpenHow = "open") => {
      const known = noteFor(id);
      if (known) {
        open(known, how);
        return;
      }
      try {
        const n = await notesApi.get(token, id);
        if (n.namespace && n.namespace !== ns) return;
        open(n, how);
      } catch {
        toast.error(t("ws.loadFailed"));
      }
    },
    [noteFor, open, token, ns, t],
  );

  const newNote = useCallback(() => {
    if (!brain.canWrite) {
      toast.error(t("editor.readOnly"));
      return;
    }
    setLayout((l) => openTab(l, { key: draftKey(), id: null, title: "" }, { newTab: true }));
  }, [brain.canWrite, t]);

  const close = useCallback((key: string) => {
    setLayout((l) => {
      const { layout: next, closed: gone } = closeTab(l, key);
      if (gone?.id) closed.current = [gone, ...closed.current.filter((x) => x.id !== gone.id)].slice(0, 20);
      return next;
    });
  }, []);

  // Deep link / spotlight target.
  const openedInitial = useRef<string | null>(null);
  useEffect(() => {
    if (!initialNoteId || openedInitial.current === initialNoteId) return;
    openedInitial.current = initialNoteId;
    void openById(initialNoteId);
  }, [initialNoteId, openById]);

  // ── editor callbacks ───────────────────────────────────────────────────
  const onSaved = useCallback(
    (key: string, n: Note) => {
      remember(n);
      list.upsert(n);
      setLayout((l) => patchTab(l, { key }, { title: n.title, category: n.category, icon: n.icon, color: n.color }));
    },
    [remember, list],
  );
  const onCreated = useCallback(
    (key: string, n: Note) => {
      remember(n);
      list.upsert(n);
      pushRecent({ id: n.id, namespace: ns, title: n.title, category: n.category });
      setLayout((l) => patchTab(l, { key }, { id: n.id, title: n.title, category: n.category }));
    },
    [remember, list, ns],
  );

  // ── row / tab / editor actions ─────────────────────────────────────────
  const actions = useNoteActions({
    token,
    brain,
    latest,
    onChanged: (n) => {
      remember(n);
      list.upsert(n);
      setLayout((l) => patchTab(l, { id: n.id }, { title: n.title, category: n.category, icon: n.icon, color: n.color }));
    },
    onRemoved: (n) => {
      list.remove(n.id);
      forgetRecent(n.id);
      setCache((c) => {
        const { [n.id]: _gone, ...rest } = c;
        return rest;
      });
      setLayout((l) => dropNote(l, n.id));
    },
    onOpen: (n, how) => open(n, how),
  });

  const menuFor = useCallback(
    (n: Note) => <NoteMenuItems note={latest(n)} kind="context" canWrite={brain.canWrite} onAction={(a) => actions.run(n, a)} />,
    [latest, brain.canWrite, actions],
  );
  const editorMenu = useCallback(
    (n: Note) => (
      <NoteMenuItems note={latest(n)} kind="dropdown" canWrite={brain.canWrite} showOpen={false} onAction={(a) => actions.run(n, a)} />
    ),
    [latest, brain.canWrite, actions],
  );

  // ── commands ───────────────────────────────────────────────────────────
  useCommand("new-note", () => newNote());
  useCommand("close-tab", () => {
    const tab = activeTab(layout);
    if (!tab) return false; // nothing open: the shell closes the window
    close(tab.key);
  });
  useCommand("reopen-tab", () => {
    const [tab, ...rest] = closed.current;
    if (!tab?.id) return;
    closed.current = rest;
    setLayout((l) => openTab(l, tab, { newTab: true }));
  });
  useCommand("next-tab", () => setLayout((l) => cycleTab(l, 1)));
  useCommand("prev-tab", () => setLayout((l) => cycleTab(l, -1)));
  useCommand("toggle-sidebar", () => setPref("sidebar", !prefs.sidebar));
  useCommand("toggle-outline", () => setPref("outline", !prefs.outline));

  const spotlightCommands: SpotlightCommand[] = [
    { id: "toggle-sidebar", label: t("ws.sidebar.toggle"), icon: <PanelLeft />, shortcut: "⌘\\", run: () => setPref("sidebar", !prefs.sidebar) },
    { id: "toggle-outline", label: t("ws.outline.toggle"), icon: <ListTree />, shortcut: "⇧⌘L", run: () => setPref("outline", !prefs.outline) },
    layout.groups.length > 1
      ? { id: "unsplit", label: t("ws.unsplit"), icon: <Columns2 />, run: () => setLayout((l) => unsplit(l)) }
      : { id: "split", label: t("ws.split"), icon: <Columns2 />, run: () => setLayout((l) => split(l)) },
  ];

  // ── render ─────────────────────────────────────────────────────────────
  const focusedTab = activeTab(layout);
  const selectedId = focusedTab?.id ?? null;
  const openIds = useMemo(
    () => new Set(layout.groups.flatMap((g) => g.tabs.map((x) => x.id).filter((x): x is string => !!x))),
    [layout],
  );
  const focusGroup = (gi: number) => setLayout((l) => (l.focus === gi ? l : { ...l, focus: gi }));
  const isSplit = layout.groups.length > 1;

  return (
    <div className="flex min-h-0 flex-1">
      <ReadingTheme />
      <Spotlight
        brain={brain}
        notes={list.notes}
        onOpenNote={(id) => void openById(id)}
        onNewNote={brain.canWrite ? newNote : undefined}
        extraCommands={spotlightCommands}
      />

      {prefs.sidebar ? (
        <aside className="flex w-[300px] min-w-0 shrink-0 flex-col border-e border-line bg-grid-bg">
          <NotesSidebar
            notes={list.notes}
            loading={list.loading}
            loadingMore={list.loadingMore}
            error={list.error}
            hasMore={list.hasMore}
            onLoadMore={() => void list.loadMore()}
            onRetry={() => void list.reload()}
            filter={prefs.filter}
            onFilter={(f) => setPref("filter", f)}
            sort={prefs.sort}
            onSort={(s) => setPref("sort", s)}
            query={query}
            onQuery={setQuery}
            selectedId={selectedId}
            openIds={openIds}
            canWrite={brain.canWrite}
            onNew={newNote}
            onOpen={(n, how) => open(n, how)}
            menuFor={menuFor}
            tree={
              // Selecting an entity searches for it: an entity need not be a note.
              <NoteTree token={token} namespace={ns} onSelect={(entity) => navigate({ name: "search", query: entity, ns })} />
            }
          />
        </aside>
      ) : null}

      <section ref={groupsRef} className="flex min-w-0 flex-1">
        {layout.groups.map((g, gi) => {
          const tab = g.tabs.find((x) => x.key === g.active) ?? null;
          const focused = layout.focus === gi;
          return (
            <Fragment key={gi}>
              {gi === 1 ? (
                <SplitDivider
                  container={() => groupsRef.current}
                  onRatio={(ratio) => setLayout((l) => ({ ...l, ratio }))}
                />
              ) : null}
              <div
                className="flex min-w-0 flex-col"
                style={isSplit && gi === 0 ? { flexBasis: `${layout.ratio * 100}%`, flexGrow: 0, flexShrink: 0 } : { flex: "1 1 0%" }}
                onPointerDownCapture={() => focusGroup(gi)}
                onFocusCapture={() => focusGroup(gi)}
              >
                <TabStrip
                  group={gi}
                  groups={layout.groups.length}
                  tabs={g.tabs}
                  active={g.active}
                  focused={focused}
                  dirty={dirty}
                  onSelect={(key) => setLayout((l) => selectTab(l, key))}
                  onClose={close}
                  onCloseOthers={(key) => g.tabs.filter((x) => x.key !== key).forEach((x) => close(x.key))}
                  onMove={(key, to, before) => setLayout((l) => moveTab(l, key, to, before))}
                  onDropNote={(n: DroppedNote, to, before) =>
                    setLayout((l) => {
                      const at = locate(l, n.id);
                      if (at) return moveTab(l, at.tab.key, to, before);
                      return moveTab(openTab(l, tabOf(n), { newTab: true, group: to }), n.id, to, before);
                    })
                  }
                  onSplit={(key) => setLayout((l) => split(l, key))}
                  onUnsplit={() => setLayout((l) => unsplit(l, 1))}
                />
                {tab ? (
                  <NoteEditor
                    key={tab.key}
                    tab={tab}
                    brain={brain}
                    token={token}
                    cached={noteFor(tab.id)}
                    focused={focused}
                    mode={mode}
                    onModeChange={setMode}
                    outlineHost={prefs.outline ? outlineHost : null}
                    onSaved={onSaved}
                    onCreated={onCreated}
                    onStatus={onStatus}
                    menu={editorMenu}
                  />
                ) : (
                  <EmptyGroup second={gi === 1} canWrite={brain.canWrite} onNew={newNote} />
                )}
              </div>
            </Fragment>
          );
        })}
      </section>

      {prefs.outline ? (
        <aside ref={setOutlineHost} className={cn("w-56 shrink-0 border-s border-line bg-grid-bg", !focusedTab && "hidden")} />
      ) : null}

      {actions.dialogs}
    </div>
  );
}

function EmptyGroup({ second, canWrite, onNew }: { second: boolean; canWrite: boolean; onNew: () => void }) {
  const { t } = useI18n();
  if (second) {
    return (
      <div className="grid-hatch flex flex-1 items-center justify-center p-6 text-center text-sm text-grid-muted">
        {t("ws.empty.group")}
      </div>
    );
  }
  return (
    <div className="grid-hatch flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <NotebookPen className="size-8 text-grid-muted" strokeWidth={1.4} />
      <div>
        <p className="text-base font-medium text-grid-fg">{t("ws.empty.title")}</p>
        <p className="mt-1 text-sm text-grid-muted">{t("ws.empty.body")}</p>
      </div>
      {canWrite ? (
        <Button onClick={onNew} className="mt-1">
          <FilePlus2 />
          {t("ws.empty.new")}
          <Kbd className="ms-1">⌘N</Kbd>
        </Button>
      ) : null}
    </div>
  );
}
