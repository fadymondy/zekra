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
        const res = await zekraApi.search(token, q, [brain.namespace], 8);
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
          <CommandList>
            <CommandEmpty>
              {searching ? t("spotlight.searching") : query.trim() ? t("spotlight.empty") : t("spotlight.hint")}
            </CommandEmpty>

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
        </Command>
      </CommandDialog>
    </>
  );
}
