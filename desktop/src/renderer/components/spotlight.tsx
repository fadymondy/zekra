import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  BrainCircuit,
  CornerDownLeft,
  FilePlus2,
  FolderPlus,
  History,
  LayoutGrid,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { loadRecent, type RecentNote } from "@/lib/notes/recent-notes";
import { noteIcon } from "@/lib/notes/note-icon";

import { brainName, type BrainListItem } from "@mobile/features/brains/brains-core";
import { groupByBrain, hitMeta, noteIdOf, normalizeQuery } from "@mobile/features/search/search-core";

import { notesApi } from "../features/notes/notes-api";
import { zekraApi, type Brain, type Note, type Recalled } from "../lib/api";
import { isDesktop } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { useCommand, useCommands, type CommandName } from "../shell/commands";
import { useRouter } from "../shell/router";
import { useAuthed } from "../shell/session";
import { BrainAvatar } from "./brain-avatar";

/*
The command palette (⌘K) — across ALL brains, like the web spotlight and the
mobile search tab:

  Recent       notes opened lately, in any brain (shared store with the web)
  Notes        title matches in the open brain — the loaded list answers at
               once, a server title search fills in the rest
  Brains       brains whose name/namespace/description match; Enter opens
  Memories     semantic search (POST /api/brain/search) over every brain,
               grouped by brain, best brain first (search-core groupByBrain);
               a hit that is a note opens the note, anything else opens it in
               the Search screen
  Commands     new note / brain, layout toggles, split, navigation

Mounted by the Brains home and the notes workspace; it owns the "spotlight"
command while mounted (elsewhere the shell opens the Search route).
*/

const DEBOUNCE_MS = 220;

export type SpotlightCommand = { id: string; label: string; icon: ReactNode; shortcut?: string; run: () => void };
type Cmd = SpotlightCommand;

export function Spotlight({ brain, notes, onOpenNote, onNewNote, extraCommands = [] }: {
  /** The open brain, when there is one (scopes the Notes group). */
  brain?: Brain;
  /** Its loaded notes, for instant title matches. */
  notes?: Note[];
  /** Open a note of the CURRENT brain in place; other brains navigate. */
  onOpenNote?: (id: string) => void;
  onNewNote?: () => void;
  /** Screen-specific commands (the workspace's layout toggles, split…). */
  extraCommands?: SpotlightCommand[];
}) {
  const { t } = useI18n();
  const { token, brains } = useAuthed();
  const { navigate } = useRouter();
  const { run } = useCommands();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Recalled[]>([]);
  const [titleHits, setTitleHits] = useState<Note[]>([]);
  const [recent, setRecent] = useState<RecentNote[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useCommand("spotlight", () => setOpen((v) => !v));

  // In the browser preview there is no native menu to own ⌘K.
  useEffect(() => {
    if (isDesktop()) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) setRecent(loadRecent());
    else setQuery("");
  }, [open]);

  const q = normalizeQuery(query);
  const brainNs = brain?.namespace;

  useEffect(() => {
    if (!q) {
      setHits([]);
      setTitleHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const [sem, titles] = await Promise.allSettled([
        zekraApi.search(token, q, undefined, 24),
        brainNs ? notesApi.list(token, brainNs, { filter: "all", sort: "updated", q }) : Promise.resolve({ notes: [] }),
      ]);
      if (seq.current !== mine) return;
      setHits(sem.status === "fulfilled" ? (sem.value.results ?? []) : []);
      setTitleHits(titles.status === "fulfilled" ? (titles.value.notes ?? []).slice(0, 8) : []);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, token, brainNs]);

  const byNs = useMemo(() => new Map((brains ?? []).map((b) => [b.namespace, b])), [brains]);
  const nameOf = (ns: string) => {
    const b = byNs.get(ns);
    return b ? brainName(b) : ns;
  };

  // Local title matches first (instant), then the server's, de-duplicated.
  const noteHits = useMemo(() => {
    if (!q) return [];
    const needle = q.toLocaleLowerCase();
    const local = (notes ?? []).filter((n) => n.title.toLocaleLowerCase().includes(needle));
    const seen = new Set(local.map((n) => n.id));
    return [...local, ...titleHits.filter((n) => !seen.has(n.id))].slice(0, 8);
  }, [q, notes, titleHits]);

  const brainHits = useMemo(() => {
    const list = (brains ?? []) as BrainListItem[];
    if (!q) return list.slice(0, 6);
    const needle = q.toLocaleLowerCase();
    return list
      .filter((b) => [b.namespace, b.displayName ?? "", b.description ?? ""].some((s) => s.toLocaleLowerCase().includes(needle)))
      .slice(0, 6);
  }, [brains, q]);

  const groups = useMemo(() => groupByBrain(hits), [hits]);

  function openNote(ns: string, id: string) {
    setOpen(false);
    if (brain && ns === brain.namespace && onOpenNote) onOpenNote(id);
    else navigate({ name: "brain", ns, tab: "notes", noteId: id });
  }

  function openHit(hit: Recalled) {
    const ns = hit.namespace ?? brain?.namespace ?? "";
    const id = noteIdOf(hit.sourceRef);
    if (id && ns) {
      openNote(ns, id);
      return;
    }
    setOpen(false);
    navigate({ name: "search", query: q, ns: ns || undefined });
  }

  const command = (name: CommandName) => () => {
    setOpen(false);
    // After the dialog has closed, so focus returns to the page first.
    setTimeout(() => run(name), 0);
  };

  const commands: Cmd[] = [
    ...(onNewNote
      ? [{ id: "new-note", label: t("action.newNote"), icon: <FilePlus2 />, shortcut: "⌘N", run: () => { setOpen(false); onNewNote(); } }]
      : [{ id: "new-note", label: t("action.newNote"), icon: <FilePlus2 />, shortcut: "⌘N", run: command("new-note") }]),
    { id: "new-brain", label: t("spot.cmd.newBrain"), icon: <FolderPlus />, shortcut: "⇧⌘N", run: command("new-brain") },
    ...extraCommands.map((c) => ({ ...c, run: () => { setOpen(false); setTimeout(c.run, 0); } })),
    { id: "brains", label: t("spot.cmd.brains"), icon: <LayoutGrid />, run: () => { setOpen(false); navigate({ name: "brains" }); } },
    { id: "search", label: t("spot.cmd.search"), icon: <Search />, run: () => { setOpen(false); navigate({ name: "search", query: q || undefined }); } },
    { id: "notifications", label: t("spot.cmd.notifications"), icon: <Bell />, run: () => { setOpen(false); navigate({ name: "notifications" }); } },
    { id: "settings", label: t("spot.cmd.settings"), icon: <Settings />, shortcut: "⌘,", run: command("settings") },
  ];
  const visibleCommands = q ? commands.filter((c) => c.label.toLocaleLowerCase().includes(q.toLocaleLowerCase())) : commands;

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("spotlight.label")}
      description={t("spotlight.description")}
      className="sm:max-w-2xl"
    >
      {/* Results arrive ranked by the server; cmdk must not re-filter them. */}
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder={t("spotlight.placeholder")} />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>
            {searching ? t("spotlight.searching") : q ? t("spotlight.empty") : t("spotlight.hint")}
          </CommandEmpty>

          {!q && recent.length > 0 ? (
            <>
              <CommandGroup heading={t("spotlight.recent")}>
                {recent.map((r) => {
                  const { Icon, color } = noteIcon(r.category);
                  return (
                    <CommandItem key={"r" + r.id} value={"recent:" + r.id} onSelect={() => openNote(r.namespace, r.id)}>
                      <Icon style={{ color }} />
                      <span className="min-w-0 flex-1 truncate" style={{ unicodeBidi: "plaintext" }}>
                        {r.title || t("notes.untitled")}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <History className="size-3" />
                        <bdi>{nameOf(r.namespace)}</bdi>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {noteHits.length > 0 && brain ? (
            <>
              <CommandGroup heading={t("spot.notes", { brain: brainName(brain) })}>
                {noteHits.map((note) => {
                  const { Icon, color } = noteIcon({ category: note.category, icon: note.icon, color: note.color });
                  return (
                    <CommandItem key={"n" + note.id} value={"note:" + note.id} onSelect={() => openNote(brain.namespace, note.id)}>
                      <Icon style={{ color }} />
                      <span className="min-w-0 flex-1 truncate" style={{ unicodeBidi: "plaintext" }}>
                        {note.title || t("notes.untitled")}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {groups.map((g) => (
            <span key={"g" + g.namespace} className="contents">
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="size-3" />
                    {t("spotlight.memories")} · <bdi>{g.namespace ? nameOf(g.namespace) : t("search.allBrains")}</bdi>
                  </span>
                }
              >
                {g.hits.map((hit) => (
                  <CommandItem key={"h" + hit.id} value={"hit:" + hit.id} onSelect={() => openHit(hit)}>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm" dir="auto">
                        {hit.content.slice(0, 220)}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{hitMeta(hit)}</span>
                    </span>
                    <KbdGroup>
                      <Kbd>
                        <CornerDownLeft className="size-3" />
                      </Kbd>
                    </KbdGroup>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </span>
          ))}

          {brainHits.length > 0 ? (
            <>
              <CommandGroup heading={t("spot.brains")}>
                {brainHits.map((b) => (
                  <CommandItem
                    key={"b" + b.namespace}
                    value={"brain:" + b.namespace}
                    onSelect={() => {
                      setOpen(false);
                      navigate({ name: "brain", ns: b.namespace, tab: "notes" });
                    }}
                  >
                    <BrainAvatar brain={b} token={token} size={18} />
                    <span className="min-w-0 flex-1 truncate" style={{ unicodeBidi: "plaintext" }}>
                      {brainName(b)}
                    </span>
                    {brainName(b) !== b.namespace ? (
                      <bdi className="font-mono text-xs text-muted-foreground">{b.namespace}</bdi>
                    ) : (
                      <BrainCircuit className="text-muted-foreground" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {visibleCommands.length > 0 ? (
            <CommandGroup heading={t("spot.commands")}>
              {visibleCommands.map((c) => (
                <CommandItem key={"c" + c.id} value={"cmd:" + c.id} onSelect={c.run}>
                  {c.icon}
                  <span className="flex-1">{c.label}</span>
                  {c.shortcut ? <CommandShortcut>{c.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            {t("spotlight.navigate")}
          </span>
          <span className="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd>Enter</Kbd>
            </KbdGroup>
            {t("spotlight.open")}
          </span>
          <span className="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd>Esc</Kbd>
            </KbdGroup>
            {t("spotlight.close")}
          </span>
          {searching ? <span className="ms-auto">{t("spotlight.searching")}</span> : null}
        </div>
      </Command>
    </CommandDialog>
  );
}
