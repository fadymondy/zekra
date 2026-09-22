import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FilePlus2, Search as SearchIcon, StickyNote } from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

import { loadRecent, type RecentNote } from "@/lib/notes/recent-notes";
import { noteIcon } from "@/lib/notes/note-icon";
import { useI18n } from "../lib/i18n";
import { zekraApi, type Brain, type Note, type Recalled } from "../lib/api";

// The same spotlight as the web console (web/components/spotlight), using the
// same shadcn Command primitives — brain search plus quick actions, opened
// with Ctrl/⌘+K. Desktop is where a spotlight earns its keep, so the shortcut
// is registered globally for the window.

const DEBOUNCE_MS = 220;

export function Spotlight({ token, brain, notes, onOpenNote, onCreate }: {
  token: string;
  brain: Brain;
  notes: Note[];
  onOpenNote: (noteId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Recalled[]>([]);
  // Scope, as on web (MH-219): narrow to the open brain or search them all.
  const [scope, setScope] = useState<"brain" | "all">("brain");
  const [recent, setRecent] = useState<RecentNote[]>([]);
  const [searching, setSearching] = useState(false);
  // Guards against a slower, older response overwriting a newer one.
  const seq = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const scoped = scope === "brain" ? [brain.namespace] : undefined;
        const res = await zekraApi.search(token, q, scoped, 8);
        if (seq.current === mine) setResults(res.results ?? []);
      } catch {
        if (seq.current === mine) setResults([]);
      } finally {
        if (seq.current === mine) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, token, brain.namespace]);

  // Local title matches answer instantly while the semantic search is in flight.
  // Read on open, not on mount: notes are opened behind the dialog and a
  // stale RECENT list is worse than none.
  useEffect(() => { if (open) setRecent(loadRecent()); }, [open]);

  const localHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return notes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 5);
  }, [notes, query]);

  function openHit(hit: Recalled) {
    setOpen(false);
    const noteId = hit.sourceRef?.startsWith("note:") ? hit.sourceRef.slice(5).split("#")[0] : undefined;
    if (noteId) onOpenNote(noteId);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="app-no-drag flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-grid-muted hover:bg-grid-soft"
        aria-label={t("spotlight.label")}
      >
        <SearchIcon className="size-4" />
        <KbdGroup className="gap-0.75">
          <Kbd className="w-5 min-w-auto">⌘</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("spotlight.label")}
        description={t("spotlight.description")}
      >
        {/* Brain results arrive ranked by the server, so cmdk must not reorder
            or filter them; the action list is filtered by hand instead. */}
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("spotlight.placeholder")} />

          <div className="flex gap-1 border-b border-line px-3 pb-2">
            {(["brain", "all"] as const).map((s2) => (
              <button
                key={s2}
                type="button"
                role="radio"
                aria-checked={scope === s2}
                onClick={() => setScope(s2)}
                className={
                  scope === s2
                    ? "rounded-md bg-grid-soft px-2.5 py-1 text-xs font-medium text-grid-fg"
                    : "rounded-md px-2.5 py-1 text-xs text-grid-muted hover:text-grid-fg"
                }
              >
                {s2 === "brain" ? t("spotlight.scopeBrain") : t("spotlight.scopeAll")}
              </button>
            ))}
          </div>

          <CommandList>
            <CommandEmpty>
              {searching ? t("spotlight.searching") : query.trim() ? t("spotlight.empty") : t("spotlight.hint")}
            </CommandEmpty>

            {!query.trim() && recent.length > 0 ? (
              <>
                <CommandGroup heading={t("spotlight.recent")}>
                  {recent.map((r) => {
                    const { Icon, color } = noteIcon(r.category);
                    return (
                      <CommandItem key={r.id} value={"recent:" + r.id} onSelect={() => { setOpen(false); onOpenNote(r.id); }}>
                        <Icon style={{ color }} />
                        <span className="min-w-0 flex-1 truncate" style={{ unicodeBidi: "plaintext" }}>
                          {r.title || t("notes.untitled")}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
              </>
            ) : null}

            {localHits.length > 0 ? (
              <>
                <CommandGroup heading={t("notes.title")}>
                  {localHits.map((note) => (
                    <CommandItem key={note.id} value={note.id} onSelect={() => { setOpen(false); onOpenNote(note.id); }}>
                      <StickyNote />
                      <span className="truncate" style={{ unicodeBidi: "plaintext" }}>
                        {note.title || t("notes.untitled")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            ) : null}

            {results.length > 0 ? (
              <>
                <CommandGroup heading={t("spotlight.memories")}>
                  {results.map((hit) => (
                    <CommandItem key={hit.id} value={hit.id} onSelect={() => openHit(hit)}>
                      <StickyNote />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{hit.content.slice(0, 120)}</span>
                        <span className="block truncate text-xs text-grid-muted">
                          {hit.namespace ?? brain.namespace} · {hit.memoryType}
                        </span>
                      </span>
                      <KbdGroup>
                        <Kbd><CornerDownLeft className="size-3" /></Kbd>
                      </KbdGroup>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            ) : null}

            <CommandGroup heading={t("spotlight.goTo")}>
              <CommandItem value="new-note" onSelect={() => { setOpen(false); onCreate(); }}>
                <FilePlus2 />
                {t("action.newNote")}
              </CommandItem>
            </CommandGroup>
          </CommandList>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-grid-muted">
            <span className="flex items-center gap-1.5">
              <KbdGroup><Kbd>↑</Kbd><Kbd>↓</Kbd></KbdGroup>{t("spotlight.navigate")}
            </span>
            <span className="flex items-center gap-1.5">
              <KbdGroup><Kbd>Enter</Kbd></KbdGroup>{t("spotlight.open")}
            </span>
            <span className="flex items-center gap-1.5">
              <KbdGroup><Kbd>Esc</Kbd></KbdGroup>{t("spotlight.close")}
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
