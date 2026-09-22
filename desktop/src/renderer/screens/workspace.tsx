import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { ConfirmDialog } from "../components/confirm-dialog";
import { Markdown } from "../components/markdown";
import { NoteTabs } from "@/components/notes/note-tabs";
import { closeTab, loadTabs, nextSelection, openTab, type OpenTab } from "@/lib/notes/open-tabs";
import { forgetRecent, pushRecent } from "@/lib/notes/recent-notes";
import { NoteRow, type NoteAction } from "../components/note-row";
import { Spotlight } from "../components/spotlight";
import { useI18n } from "../lib/i18n";
import { zekraApi, type Brain, type Note, type Recalled } from "../lib/api";

type Mode = "notes" | "search";

export function Workspace({ token, brain, onDirtyChange }: {
  token: string;
  brain: Brain;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("notes");
  const [notes, setNotes] = useState<Note[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Note | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  useEffect(() => setTabs(loadTabs(brain.namespace)), [brain.namespace]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recalled[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Destructive row actions route through a confirmation instead of firing
  // straight away; pin applies immediately since it is trivially reversible.
  const [pending, setPending] = useState<{ note: Note; action: Exclude<NoteAction, "pin"> } | null>(null);

  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await zekraApi.notes(token, brain.namespace, { archived: showArchived });
      setNotes(page.notes);
      setCursor(page.nextCursor);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notes");
    }
  }, [token, brain.namespace, showArchived]);

  /*
  Cursor paging. The sidebar previously fetched one page and stopped, so a
  brain with more notes than the limit showed a truncated list with nothing to
  say so — worse than an empty one.

  Guarded on loadingMore because the sentinel can intersect repeatedly while a
  request is still in flight, which would fetch the same cursor several times.
  */
  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await zekraApi.notes(token, brain.namespace, { archived: showArchived, cursor });
      // Append by id rather than concatenating blindly: a note edited between
      // pages can legitimately appear twice.
      setNotes((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.notes.filter((n) => !seen.has(n.id))];
      });
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more notes");
    } finally {
      setLoadingMore(false);
    }
  }, [token, brain.namespace, showArchived, cursor, loadingMore]);

  // Fetch the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function open(note: Note) {
    setSelected(note);
    setTabs(openTab(brain.namespace, { id: note.id, title: note.title, category: note.category }));
    // Feeds the spotlight's RECENT section (MH-219); shared store with web.
    pushRecent({ id: note.id, namespace: brain.namespace, title: note.title, category: note.category });
    setTitle(note.title);
    setBody(note.body ?? "");
    setDirty(false);
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    try {
      const saved = await zekraApi.updateNote(token, selected, { title, body });
      setSelected(saved);
      setDirty(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    const note = await zekraApi.createNote(token, brain.namespace);
    await load();
    open(note);
  }

  async function togglePin(note: Note) {
    await zekraApi.updateNote(token, note, { pinned: !note.pinned });
    await load();
  }

  // MH-308: the icon/colour override is a plain note patch; "" clears it.
  async function setAppearance(note: Note, patch: { icon?: string; color?: string }) {
    try {
      const saved = await zekraApi.updateNote(token, note, patch);
      if (selected?.id === note.id) setSelected(saved);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function runAction(note: Note, action: NoteAction) {
    if (action === "pin") { await togglePin(note); return; }
    setPending({ note, action });
  }

  async function confirmPending() {
    if (!pending) return;
    const { note, action } = pending;
    setPending(null);
    try {
      if (action === "delete") {
        await zekraApi.deleteNote(token, note);
        setTabs(closeTab(brain.namespace, note.id));
        forgetRecent(note.id);
        if (selected?.id === note.id) setSelected(null);
      } else {
        await zekraApi.updateNote(token, note, { archived: !note.archived });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await zekraApi.search(token, q, [brain.namespace]);
      setResults(res.results ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const sorted = [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    if (!needle) return sorted;
    return sorted.filter(
      (n) => n.title.toLowerCase().includes(needle) || (n.body ?? "").toLowerCase().includes(needle),
    );
  }, [notes, filter]);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Notes / search list */}
      <aside className="flex w-[340px] min-w-0 shrink-0 flex-col border-e border-line">
        <div className="flex items-center gap-2 p-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex-1">
            <TabsList className="w-full">
              <TabsTrigger value="notes" className="flex-1">{t("notes.title")}</TabsTrigger>
              <TabsTrigger value="search" className="flex-1">{t("search.title")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Spotlight
            token={token}
            brain={brain}
            notes={notes}
            onOpenNote={(id) => {
              const note = notes.find((n) => n.id === id);
              if (note) open(note);
            }}
            onCreate={() => void create()}
          />
          <Button size="icon-sm" variant="outline" onClick={() => void create()} aria-label={t("action.newNote")}>
            <FilePlus2 />
          </Button>
        </div>

        {mode === "notes" ? (
          <>
            <div className="px-3 pb-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("notes.search")}
              />
            </div>
            <label className="flex items-center gap-2 px-3 pb-2 text-xs text-grid-muted">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              {t("notes.showArchived")}
            </label>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col">
                {visible.length === 0 ? (
                  <p className="p-4 text-sm text-grid-muted">{t("notes.empty")}</p>
                ) : (
                  visible.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      selected={selected?.id === note.id}
                      onOpen={() => open(note)}
                      onAction={(action) => void runAction(note, action)}
                      onAppearance={brain.canWrite ? (patch) => void setAppearance(note, patch) : undefined}
                    />
                  ))
                )}
                {cursor ? (
                  <div ref={sentinel} className="p-3 text-center text-xs text-grid-muted">
                    {loadingMore ? t("notes.loadingMore") : ""}
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          </>
        ) : (
          <>
            <div className="flex gap-2 px-3 pb-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
                placeholder={t("search.placeholder")}
              />
              <Button size="icon" variant="outline" onClick={() => void runSearch()} aria-label={t("search.title")}>
                <Search />
              </Button>
            </div>
            <Separator />
            <ScrollArea className="min-h-0 flex-1">
              {searching ? (
                <p className="p-4 text-sm text-grid-muted">{t("search.searching")}</p>
              ) : results === null ? (
                <div className="p-4">
                  <p className="text-sm font-medium">{t("search.start")}</p>
                  <p className="text-sm text-grid-muted">{t("search.startBody")}</p>
                </div>
              ) : results.length === 0 ? (
                <div className="p-4">
                  <p className="text-sm font-medium">{t("search.empty")}</p>
                  <p className="text-sm text-grid-muted">{t("search.emptyBody")}</p>
                </div>
              ) : (
                results.map((hit) => (
                  <div key={hit.id} className="border-b border-line p-3">
                    <p className="grid-micro mb-1 text-grid-muted">
                      {hit.namespace ?? brain.namespace} · {hit.memoryType}
                    </p>
                    <p className="line-clamp-4 text-sm text-grid-body">{hit.content}</p>
                  </div>
                ))
              )}
            </ScrollArea>
          </>
        )}
      </aside>

      {/* Editor */}
      <section className="grid-hatch flex min-w-0 flex-1 flex-col">
        {/* Open notes as tabs (MH-218), reusing the web's strip and store so
            desktop and browser agree on what "open" means for a brain. */}
        <NoteTabs
          tabs={tabs}
          activeId={selected?.id ?? null}
          labels={{ openTabs: t("notes.title"), untitled: t("notes.untitled"), close: t("action.close") }}
          onSelect={(id) => {
            // open(), not setSelected: the editor's title and body are
            // separate state that setSelected alone would leave on the
            // previous note.
            const note = notes.find((n) => n.id === id);
            if (note) open(note);
          }}
          onClose={(id) => {
            setTabs(closeTab(brain.namespace, id));
            if (selected?.id === id) {
              const after = nextSelection(tabs, id, selected.id);
              const note = after ? notes.find((n) => n.id === after) : undefined;
              if (note) open(note);
              else setSelected(null);
            }
          }}
        />
        {!selected ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-grid-muted">{t("notes.select")}</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 bg-grid-bg p-5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Label htmlFor="note-title" className="sr-only">{t("editor.title")}</Label>
                <Input
                  id="note-title"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                  placeholder={t("notes.untitled")}
                  className="h-auto border-0 bg-transparent px-0 text-lg font-medium shadow-none focus-visible:ring-0"
                />
              </div>
              <Button onClick={() => void save()} disabled={!dirty || saving}>
                {saving ? t("action.save") : dirty ? t("action.unsaved") : t("action.saved")}
              </Button>
            </div>

            {error ? <p className="text-sm text-grid-danger">{error}</p> : null}

            <Tabs defaultValue="preview" className="flex min-h-0 flex-1 flex-col">
              <TabsList>
                <TabsTrigger value="edit">{t("editor.edit")}</TabsTrigger>
                <TabsTrigger value="preview">{t("editor.preview")}</TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="min-h-0 flex-1">
                <Textarea
                  value={body}
                  onChange={(e) => { setBody(e.target.value); setDirty(true); }}
                  placeholder={t("editor.placeholder")}
                  className="h-full min-h-0 resize-none font-mono text-sm"
                />
              </TabsContent>
              <TabsContent value="preview" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  {body.trim() ? <Markdown text={body} /> : <p className="text-sm text-grid-muted">{t("editor.empty")}</p>}
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </section>
      <ConfirmDialog
        open={!!pending}
        destructive={pending?.action === "delete"}
        title={
          pending?.action === "delete"
            ? t("notes.deleteConfirm")
            : pending?.note.archived
              ? t("row.unarchiveConfirm")
              : t("row.archiveConfirm")
        }
        body={
          pending?.action === "delete"
            ? t("notes.deleteBody")
            : pending?.note.archived
              ? t("row.unarchiveBody")
              : t("row.archiveBody")
        }
        confirmLabel={
          pending?.action === "delete"
            ? t("action.delete")
            : pending?.note.archived
              ? t("row.unarchive")
              : t("row.archive")
        }
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
