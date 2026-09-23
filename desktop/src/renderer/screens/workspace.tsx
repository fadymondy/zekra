import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ListTree, NotebookPen, PanelLeft, SquarePen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import type { AutosaveStatus } from "@mobile/features/editor/autosave-core";

import { IconButton, PaneResizer } from "../components/chrome";
import type { OpenHow } from "../components/note-row";
import { NoteTree } from "../components/note-tree";
import { SplitDivider } from "../features/editor/editor-chrome";
import { NoteEditor, type NoteDraft } from "../features/editor/note-editor";
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
import { noteMenuAction, noteMenuItems, type NoteMenuAction } from "../features/notes/note-menu";
import { notesApi } from "../features/notes/notes-api";
import type { NoteFilter, NoteSort } from "../features/notes/notes-model";
import { NotesSidebar, type ListFilter } from "../features/notes/notes-sidebar";
import { useNoteActions } from "../features/notes/use-note-actions";
import { useNotesList } from "../features/notes/use-notes-list";
import type { Brain, Note } from "../lib/api";
import { bridge } from "../lib/bridge";
import { showMenu } from "../lib/native-menu";
import { forgetRecentNote, pushRecentNote } from "../lib/recent";
import { useI18n } from "../lib/i18n";
import { useCommand } from "../shell/commands";
import { useRouter } from "../shell/router";
import { toast } from "../shell/toast";
import { ToolbarActions } from "../shell/toolbar";

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
  toggle-outline ⇧⌘L
New Note (⌘N, the toolbar pen, the empty state) opens a New Note WINDOW for
this brain (Health Debug's "add" windows); a note saved in any other window
is folded into the list live (the "note-saved" broadcast).
The notes list column toggles from the toolbar (⌘\ is the app sidebar's).
The focused editor adds find ⌘F, save ⌘S and File ▸ Export.
*/

const PREFS = "zekra.desktop.workspace";
/** `sidebar` is the notes LIST column (the app sidebar is the shell's). */
type Prefs = { sidebar: boolean; outline: boolean; filter: NoteFilter; sort: NoteSort; listWidth: number };
const LIST_WIDTH = { min: 220, max: 440, initial: 290 };
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>;
    return {
      sidebar: p.sidebar ?? true,
      outline: p.outline ?? true,
      filter: p.filter === "pinned" || p.filter === "archived" ? p.filter : "all",
      sort: p.sort === "created" || p.sort === "title" ? p.sort : "updated",
      listWidth:
        typeof p.listWidth === "number" ? Math.max(LIST_WIDTH.min, Math.min(LIST_WIDTH.max, p.listWidth)) : LIST_WIDTH.initial,
    };
  } catch {
    return { sidebar: true, outline: true, filter: "all", sort: "updated", listWidth: LIST_WIDTH.initial };
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

export function Workspace({ token, brain, initialNoteId, list: listFilter = "all", onDirtyChange }: {
  token: string;
  brain: Brain;
  /** Open this note (the brain route's noteId: deep links, spotlight). */
  initialNoteId?: string;
  /** Which list the source list picked (All / Pinned / Recent / Archived). */
  list?: ListFilter;
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
  const closed = useRef<DeskTab[]>([]);
  const [outlineHost, setOutlineHost] = useState<HTMLElement | null>(null);
  const [chromeHosts, setChromeHosts] = useState<(HTMLElement | null)[]>([null, null]);
  // Stable per-group ref callbacks (a fresh callback each render would detach
  // and re-attach the host every render, and loop through setState).
  const chromeRefs = useMemo(
    () =>
      [0, 1].map((gi) => (el: HTMLElement | null) =>
        setChromeHosts((h) => (h[gi] === el ? h : Object.assign([...h], { [gi]: el }))),
      ),
    [],
  );
  const [listWidth, setListWidth] = useState(prefs.listWidth);
  const groupsRef = useRef<HTMLElement | null>(null);

  // ── notes list ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [serverQ, setServerQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setServerQ(query.trim()), 250);
    return () => clearTimeout(h);
  }, [query]);
  // "Recent" is the full list, newest first, kept to the last 7 days.
  const apiFilter: NoteFilter = listFilter === "recent" ? "all" : listFilter;
  const apiSort: NoteSort = listFilter === "recent" ? "updated" : prefs.sort;
  const view = useMemo(() => ({ filter: apiFilter, sort: apiSort, q: serverQ }), [apiFilter, apiSort, serverQ]);
  const list = useNotesList(token, ns, view);
  const shown = useMemo(
    () =>
      listFilter === "recent"
        ? list.notes.filter((n) => Date.now() - new Date(n.updatedAt).getTime() < 7 * 86_400_000)
        : list.notes,
    [list.notes, listFilter],
  );

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

  // Titles/descriptions as typed, before they are saved: the list row and the
  // tab follow the editor live (keyed by tab; cleared once the editor saved).
  const [drafts, setDrafts] = useState<Record<string, NoteDraft>>({});
  const onDraft = useCallback((key: string, d: NoteDraft | null) => {
    setDrafts((m) => {
      if (!d) {
        if (!(key in m)) return m;
        const { [key]: _gone, ...rest } = m;
        return rest;
      }
      return { ...m, [key]: d };
    });
  }, []);
  const draftById = useMemo(() => {
    const out = new Map<string, NoteDraft>();
    for (const d of Object.values(drafts)) if (d.id) out.set(d.id, d);
    return out;
  }, [drafts]);
  const listed = useMemo(
    () =>
      draftById.size
        ? shown.map((n) => {
            const d = draftById.get(n.id);
            return d && (d.title !== n.title || d.description !== (n.description ?? ""))
              ? { ...n, title: d.title, description: d.description }
              : n;
          })
        : shown,
    [shown, draftById],
  );

  // Rename (⌘R / F2 / double-click a row / the menus): open the note and
  // select its title. The counter re-arms the editor's effect every time.
  const [renameReq, setRenameReq] = useState<{ id: string; n: number } | null>(null);

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
      pushRecentNote({ id: n.id, namespace: ns, title: n.title, category: n.category });
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
    // Its own window (native-ui.ts openNewNoteWindow); the browser preview
    // has none and opens a draft tab instead.
    if (bridge().openNewNoteWindow) {
      void bridge().openNewNoteWindow?.(ns);
      return;
    }
    setLayout((l) => openTab(l, { key: draftKey(), id: null, title: "" }, { newTab: true }));
  }, [brain.canWrite, t, ns]);

  // A note created / saved in another window (a note window, New Note).
  const upsertListed = list.upsert;
  useEffect(
    () =>
      bridge().onBroadcast?.((msg) => {
        if (msg.kind !== "note-saved") return;
        const n = msg.note as unknown as Note;
        if (n.namespace && n.namespace !== ns) return;
        remember(n);
        upsertListed(n);
        setLayout((l) => patchTab(l, { id: n.id }, { title: n.title, category: n.category, icon: n.icon, color: n.color }));
      }),
    [ns, remember, upsertListed],
  );

  const renameNote = useCallback(
    (n: Note) => {
      if (!brain.canWrite) return;
      open(n);
      setRenameReq((r) => ({ id: n.id, n: (r?.n ?? 0) + 1 }));
    },
    [brain.canWrite, open],
  );

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
      pushRecentNote({ id: n.id, namespace: ns, title: n.title, category: n.category });
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
      forgetRecentNote(n.id);
      setCache((c) => {
        const { [n.id]: _gone, ...rest } = c;
        return rest;
      });
      setLayout((l) => dropNote(l, n.id));
    },
    onOpen: (n, how) => open(n, how),
    onRename: renameNote,
  });

  // Native menus (lib/native-menu.ts) from one definition (note-menu.tsx).
  const runMenu = useCallback(
    (n: Note, id: string | null) => {
      const a = id ? noteMenuAction(id) : null;
      if (a) actions.run(n, a);
    },
    [actions],
  );
  const onRowMenu = useCallback(
    (n: Note, e: ReactMouseEvent) => {
      e.preventDefault();
      void showMenu(noteMenuItems(latest(n), t, { canWrite: brain.canWrite }), e).then((id) => runMenu(n, id));
    },
    [latest, t, brain.canWrite, runMenu],
  );
  const onEditorMenu = useCallback(
    (n: Note, anchor: Element) => {
      void showMenu(noteMenuItems(latest(n), t, { canWrite: brain.canWrite, showOpen: false }), anchor).then((id) => runMenu(n, id));
    },
    [latest, t, brain.canWrite, runMenu],
  );

  // The focused editor's note, for the app menu's Note ▸ … commands.
  const focusedNote = (): Note | null => {
    const tab = activeTab(layout);
    return tab?.id ? noteFor(tab.id) : null;
  };
  const onFocused = (a: NoteMenuAction) => {
    const n = focusedNote();
    if (!n) return false;
    actions.run(n, a);
  };
  useCommand("open-in-new-window", () => onFocused({ kind: "open-window" }));
  useCommand("note:pin", () => (brain.canWrite ? onFocused({ kind: "pin" }) : false));
  useCommand("note:archive", () => (brain.canWrite ? onFocused({ kind: "archive" }) : false));
  useCommand("note:appearance", () => (brain.canWrite ? onFocused({ kind: "appearance-picker" }) : false));
  useCommand("note:versions", () => onFocused({ kind: "versions" }));
  useCommand("note:copy", () => onFocused({ kind: "copy" }));
  useCommand("note:delete", () => (brain.canWrite ? onFocused({ kind: "delete" }) : false));
  useCommand("toggle-list", () => setPref("sidebar", !prefs.sidebar));

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
  useCommand("toggle-outline", () => setPref("outline", !prefs.outline));

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
      <ToolbarActions>
        <IconButton label={t("tb.list")} active={prefs.sidebar} onClick={() => setPref("sidebar", !prefs.sidebar)}>
          <PanelLeft className="rtl:-scale-x-100" />
        </IconButton>
        <IconButton label={t("ws.outline.toggle")} shortcut="⇧⌘L" active={prefs.outline && !!focusedTab} disabled={!focusedTab} onClick={() => setPref("outline", !prefs.outline)}>
          <ListTree />
        </IconButton>
        {brain.canWrite ? (
          <IconButton label={t("tb.newNote")} shortcut="⌘N" onClick={newNote}>
            <SquarePen />
          </IconButton>
        ) : null}
      </ToolbarActions>

      {prefs.sidebar ? (
        <aside className="relative flex min-w-0 shrink-0 flex-col border-e border-border/60 bg-background" style={{ width: listWidth }}>
          <NotesSidebar
            notes={listed}
            loading={list.loading}
            loadingMore={list.loadingMore}
            error={list.error}
            hasMore={list.hasMore}
            onLoadMore={() => void list.loadMore()}
            onRetry={() => void list.reload()}
            filter={listFilter}
            sort={prefs.sort}
            onSort={(s) => setPref("sort", s)}
            query={query}
            onQuery={setQuery}
            selectedId={selectedId}
            openIds={openIds}
            onOpen={(n, how) =>
              how === "open-window" ? actions.run(n, { kind: "open-window" }) : how === "rename" ? renameNote(n) : open(n, how)
            }
            onRowMenu={onRowMenu}
            tree={
              // Selecting an entity searches for it: an entity need not be a note.
              <NoteTree token={token} namespace={ns} onSelect={(entity) => navigate({ name: "search", query: entity, ns })} />
            }
          />
          <PaneResizer
            label={t("list.resize")}
            width={listWidth}
            min={LIST_WIDTH.min}
            max={LIST_WIDTH.max}
            reset={LIST_WIDTH.initial}
            onWidth={setListWidth}
            onDone={(w) => setPref("listWidth", w)}
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
                {g.tabs.length || isSplit ? (
                  <TabStrip
                    group={gi}
                    groups={layout.groups.length}
                    tabs={g.tabs.map((x) => (drafts[x.key] && drafts[x.key].title !== x.title ? { ...x, title: drafts[x.key].title } : x))}
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
                    actionsRef={chromeRefs[gi]}
                    onOpenWindow={(key) => {
                      const t0 = g.tabs.find((x) => x.key === key);
                      if (t0?.id) void bridge().openNoteWindow?.({ namespace: ns, id: t0.id, title: t0.title });
                    }}
                  />
                ) : null}
                {tab ? (
                  <NoteEditor
                    key={tab.key}
                    tab={tab}
                    brain={brain}
                    token={token}
                    cached={noteFor(tab.id)}
                    focused={focused}
                    rename={tab.id && renameReq?.id === tab.id ? renameReq.n : 0}
                    onDraft={onDraft}
                    outlineHost={prefs.outline ? outlineHost : null}
                    chromeHost={chromeHosts[gi]}
                    onSaved={onSaved}
                    onCreated={onCreated}
                    onStatus={onStatus}
                    onMenu={onEditorMenu}
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
        <aside ref={setOutlineHost} className={cn("w-56 shrink-0 border-s border-border/60 bg-background", !focusedTab && "hidden")} />
      ) : null}

      {actions.dialogs}
    </div>
  );
}

function EmptyGroup({ second, canWrite, onNew }: { second: boolean; canWrite: boolean; onNew: () => void }) {
  const { t } = useI18n();
  if (second) {
    return (
      <Empty className="bg-background">
        <EmptyDescription className="text-[14px]">{t("ws.empty.group")}</EmptyDescription>
      </Empty>
    );
  }
  return (
    <Empty className="gap-5 bg-background">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon" className="mb-2 size-11 rounded-xl bg-muted text-muted-foreground">
          <NotebookPen className="size-5 stroke-[1.5]" />
        </EmptyMedia>
        <EmptyTitle className="text-[15px] font-semibold">{t("ws.empty.title")}</EmptyTitle>
        <EmptyDescription className="text-[14px]">{t("ws.empty.body")}</EmptyDescription>
      </EmptyHeader>
      {canWrite ? (
        <EmptyContent>
          <Button onClick={onNew} className="h-8 gap-2 px-3 text-[14px]">
            <SquarePen className="stroke-[1.75]" />
            {t("ws.empty.new")}
            <Kbd className="ms-1 bg-primary-foreground/15 text-primary-foreground">⌘N</Kbd>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
