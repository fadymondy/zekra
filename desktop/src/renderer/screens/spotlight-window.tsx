import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Bell,
  CornerDownLeft,
  FilePlus2,
  FolderPlus,
  LayoutGrid,
  Search,
  Settings,
  Sparkles,
  Zap,
} from "lucide-react";

import { loadRecent, type RecentNote } from "@/lib/notes/recent-notes";
import { noteIcon } from "@/lib/notes/note-icon";

import { noteIdOf, normalizeQuery } from "@mobile/features/search/search-core";

import { BrainAvatar } from "../components/brain-avatar";
import { ZekraMark } from "../components/zekra-mark";
import { notesApi } from "../features/notes/notes-api";
import { zekraApi, type Brain } from "../lib/api";
import { bridge } from "../lib/bridge";
import { useI18n, type TKey } from "../lib/i18n";
import { usePlatform } from "../lib/platform";
import { useSession } from "../shell/session";

/*
Spotlight — the search / command panel as its own native window (Health
Debug's palette: healthdebug/desktop/renderer/surfaces/palette.tsx; the
window is src/main/app-windows.ts): a frameless floating panel over the
system material (macOS vibrancy, Windows 11 acrylic), near the top of the
screen. ⌘K in any Zekra window, the toolbar's search field, the tray, and an
optional global shortcut (Settings ▸ Services) open it.

  Recent    notes opened lately, in any brain            (no query)
  Notes     title matches: recent notes at once, the active brain's list and
            a semantic search over every brain as they answer
  Brains    brains whose name / namespace / description match
  Actions   New Note, New Brain, Quick Capture, Notifications, All Brains,
            Settings — and "Search all brains for …" with a query

↑/↓ move, Enter opens, ⌘1–9 open the n-th result, Esc (or clicking away)
closes. Picking a note or a brain focuses the MAIN window there (openInMain);
actions open their own windows. The panel sizes itself to its results.
*/

const DEBOUNCE_MS = 200;

type Item = {
  key: string;
  group: "recent" | "notes" | "brains" | "actions";
  title: string;
  /** Rendered in its own direction (user content). */
  content?: boolean;
  sub?: string;
  icon: ReactNode;
  hint?: string;
  run: () => void;
};

const GROUP_LABEL: Record<Item["group"], TKey> = {
  recent: "win.spot.recent",
  notes: "win.spot.notes",
  brains: "win.spot.brains",
  actions: "win.spot.actions",
};
const ORDER: Item["group"][] = ["recent", "notes", "brains", "actions"];

type NoteHit = { id: string; namespace: string; title: string; category?: string | null; icon?: string; color?: string; semantic?: boolean };

export function SpotlightWindow() {
  const { t } = useI18n();
  const { token, user, brains, settings } = useSession();
  const { platform } = usePlatform();
  const mod = platform === "darwin" ? "⌘" : "Ctrl+";
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<RecentNote[]>(() => loadRecent());
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Shown again: start fresh, like Spotlight.
  useEffect(
    () =>
      bridge().onWindowShown?.(() => {
        setQuery("");
        setActive(0);
        setHits([]);
        setRecent(loadRecent());
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
      }),
    [],
  );
  useEffect(() => {
    document.title = t("win.spot.placeholder");
  }, [t]);

  const q = normalizeQuery(query);
  const signedIn = Boolean(user && token);

  // Server matches: the active brain's titles + a semantic search everywhere.
  useEffect(() => {
    if (!q || !token) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const ns = settings.activeBrain;
      const [titles, sem] = await Promise.allSettled([
        ns ? notesApi.list(token, ns, { filter: "all", sort: "updated", q }) : Promise.resolve({ notes: [] }),
        zekraApi.search(token, q, undefined, 16),
      ]);
      if (seq.current !== mine) return;
      const out: NoteHit[] = [];
      if (titles.status === "fulfilled") {
        for (const n of (titles.value.notes ?? []).slice(0, 6)) {
          out.push({ id: n.id, namespace: n.namespace || ns || "", title: n.title, category: n.category, icon: n.icon, color: n.color });
        }
      }
      if (sem.status === "fulfilled") {
        for (const r of sem.value.results ?? []) {
          const id = noteIdOf(r.sourceRef);
          if (!id || !r.namespace || out.some((x) => x.id === id)) continue;
          out.push({ id, namespace: r.namespace, title: r.content.split("\n")[0].replace(/^#+\s*/, "").slice(0, 120), semantic: true });
        }
      }
      setHits(out.slice(0, 8));
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, token, settings.activeBrain]);

  const byNs = useMemo(() => new Map((brains ?? []).map((b) => [b.namespace, b])), [brains]);
  const brainLabel = (ns: string) => byNs.get(ns)?.displayName || ns;

  const openNote = (ns: string, id: string) => void bridge().openInMain?.(`note:${ns}:${id}`);
  const openBrain = (b: Brain) => void bridge().openInMain?.(`brain:${b.namespace}`);
  const close = () => void bridge().hideSelf?.();

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const needle = q.toLocaleLowerCase();
    const noteItem = (group: "recent" | "notes", n: NoteHit | RecentNote, semantic = false): Item => {
      const { Icon, color } = noteIcon({ category: n.category, icon: "icon" in n ? n.icon : undefined, color: "color" in n ? n.color : undefined });
      return {
        key: `${group}:${n.id}`,
        group,
        title: n.title || t("notes.untitled"),
        content: true,
        sub: brainLabel(n.namespace),
        icon: semantic ? <Sparkles className="text-muted-foreground" /> : <Icon style={{ color }} />,
        run: () => openNote(n.namespace, n.id),
      };
    };

    if (signedIn) {
      if (!q) {
        for (const r of recent.slice(0, 5)) out.push(noteItem("recent", r));
      } else {
        const local = recent.filter((r) => r.title.toLocaleLowerCase().includes(needle));
        const seen = new Set<string>();
        for (const n of [...local, ...hits]) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          out.push(noteItem("notes", n, "semantic" in n && Boolean(n.semantic)));
          if (seen.size >= 8) break;
        }
      }
      const bl = (brains ?? []).filter(
        (b) => !q || [b.namespace, b.displayName ?? "", b.description ?? ""].some((s) => s.toLocaleLowerCase().includes(needle)),
      );
      for (const b of bl.slice(0, q ? 6 : 4)) {
        out.push({
          key: `brain:${b.namespace}`,
          group: "brains",
          title: b.displayName || b.namespace,
          content: true,
          sub: b.displayName && b.displayName !== b.namespace ? b.namespace : undefined,
          icon: <BrainAvatar brain={b} token={token} size={18} />,
          run: () => openBrain(b),
        });
      }
    }

    const actions: Item[] = [
      ...(q && signedIn
        ? [{ key: "act:search", group: "actions" as const, title: t("win.spot.searchAll", { q }), icon: <Search />, run: () => void bridge().openInMain?.(`search:${q}`) }]
        : []),
      ...(signedIn
        ? [
            { key: "act:new-note", group: "actions" as const, title: t("win.act.newNote"), icon: <FilePlus2 />, hint: `${mod}N`, run: () => void bridge().openNewNoteWindow?.(settings.activeBrain) },
            { key: "act:new-brain", group: "actions" as const, title: t("win.act.newBrain"), icon: <FolderPlus />, hint: platform === "darwin" ? "⇧⌘N" : "Ctrl+Shift+N", run: () => void bridge().openNewBrainWindow?.() },
            { key: "act:capture", group: "actions" as const, title: t("win.act.capture"), icon: <Zap />, run: () => { close(); void bridge().openQuickCapture?.(); } },
            { key: "act:notifications", group: "actions" as const, title: t("win.act.notifications"), icon: <Bell />, run: () => void bridge().openInMain?.("notifications") },
            { key: "act:brains", group: "actions" as const, title: t("win.act.brains"), icon: <LayoutGrid />, run: () => void bridge().openInMain?.("brains") },
          ]
        : []),
      { key: "act:settings", group: "actions", title: t("win.act.settings"), icon: <Settings />, hint: `${mod},`, run: () => void bridge().openSettingsWindow?.("general") },
    ];
    // With a query, actions are filtered by their label (the search one stays).
    for (const a of actions) if (!q || a.key === "act:search" || a.title.toLocaleLowerCase().includes(needle)) out.push(a);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, recent, hits, brains, signedIn, token, t, settings.activeBrain, mod, platform]);

  useEffect(() => setActive(0), [q]);
  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${safeActive}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeActive]);

  // Keep the panel exactly as tall as what it shows.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => void bridge().resizeSelf?.(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[safeActive]?.run();
    } else if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      items[Number(e.key) - 1]?.run();
    }
  }

  let index = -1;
  return (
    <div ref={root} className="spotlight flex max-h-[560px] flex-col" onKeyDown={onKeyDown}>
      <div className="spotlight-input app-drag flex h-14 shrink-0 items-center gap-3 px-4">
        <Search className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <input
          ref={input}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("win.spot.placeholder")}
          aria-label={t("win.spot.placeholder")}
          aria-controls="spot-list"
          aria-activedescendant={items[safeActive] ? `spot-${safeActive}` : undefined}
          spellCheck={false}
          dir="auto"
          className="app-no-drag min-w-0 flex-1 bg-transparent text-[19px] text-foreground outline-none placeholder:text-muted-foreground/80"
        />
        {searching ? <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" /> : <ZekraMark size={18} className="shrink-0 opacity-80" />}
      </div>

      {!signedIn ? <p className="border-t border-border/60 px-4 py-2 text-ui-sm text-muted-foreground">{t("win.spot.signedOut")}</p> : null}

      <div id="spot-list" ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto border-t border-border/60 px-2 py-1.5 empty:hidden">
        {ORDER.map((g) => {
          const group = items.filter((i) => i.group === g);
          if (!group.length) return null;
          return (
            <div key={g} role="presentation" className="pb-1">
              <div className="spotlight-group px-2.5 pt-2 pb-1">{t(GROUP_LABEL[g])}</div>
              {group.map((item) => {
                index += 1;
                const i = index;
                const on = i === safeActive;
                return (
                  <div
                    key={item.key}
                    id={`spot-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    data-active={on || undefined}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => item.run()}
                    className="spotlight-item flex h-10 items-center gap-3 rounded-md px-2.5"
                  >
                    <span className="spotlight-icon flex size-6 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:stroke-[1.75]">{item.icon}</span>
                    <span
                      className="min-w-0 flex-1 truncate text-ui"
                      dir={item.content ? "auto" : undefined}
                      style={item.content ? { unicodeBidi: "plaintext" } : undefined}
                    >
                      {item.title}
                    </span>
                    {item.sub ? (
                      <span className="spotlight-sub max-w-[40%] shrink-0 truncate text-ui-sm" dir="auto">
                        {item.sub}
                      </span>
                    ) : null}
                    {on ? (
                      <CornerDownLeft className="size-3.5 shrink-0 opacity-80 rtl:-scale-x-100" aria-hidden />
                    ) : item.hint ? (
                      <span className="spotlight-sub shrink-0 text-[12px] tabular-nums" dir="ltr">
                        {item.hint}
                      </span>
                    ) : i < 9 ? (
                      <span className="spotlight-sub shrink-0 text-[12px] tabular-nums opacity-70" dir="ltr">{`${mod}${i + 1}`}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {q && !searching && !items.some((i) => i.group === "notes" || i.group === "brains") && signedIn ? (
          <p className="px-3 pb-2 pt-1 text-ui-sm text-muted-foreground">{t("win.spot.empty", { q })}</p>
        ) : null}
      </div>

      <footer className="flex h-8 shrink-0 items-center gap-4 border-t border-border/60 px-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <kbd className="spotlight-kbd">↑</kbd>
          <kbd className="spotlight-kbd">↓</kbd>
          {t("win.spot.navigate")}
        </span>
        <span className="flex items-center gap-1.5">
          <kbd className="spotlight-kbd">↩</kbd>
          {t("win.spot.open")}
        </span>
        <span className="ms-auto flex items-center gap-1.5">
          <kbd className="spotlight-kbd">esc</kbd>
          {t("win.spot.close")}
        </span>
      </footer>
    </div>
  );
}
