"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ActivityIcon,
  BrainIcon,
  CircleHelpIcon,
  CornerDownLeftIcon,
  MessagesSquareIcon,
  NetworkIcon,
  PlugIcon,
  PlugZapIcon,
  PresentationIcon,
  SearchIcon,
  ShieldCheckIcon,
  StickyNoteIcon,
  UserIcon,
} from "lucide-react"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { brainApi, type Recalled } from "@/lib/api"
import { noteIcon } from "@/lib/notes/note-icon"
import { loadRecent, type RecentNote } from "@/lib/notes/recent-notes"
import { useTranslations } from "@/lib/i18n"

// Spotlight search over the brain, styled after fadymondy.com-v2's
// command-menu-panel: grouped, keyword-searchable actions plus live results.
// Unlike that one, the results here come from Zekra's hybrid recall engine
// (POST /api/brain/search), so they are semantic, not a title filter.

type Action = {
  title: string
  icon: React.ReactNode
  href: string
  keywords?: string[]
}

const DEBOUNCE_MS = 220

export function SpotlightPanel({ open, onOpenChange, namespace }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  namespace?: string
}) {
  const router = useRouter()
  const { t, locale } = useTranslations()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Recalled[]>([])
  const [searching, setSearching] = useState(false)
  // Guards against an older, slower response overwriting a newer one.
  const seq = useRef(0)

  const actions = useMemo<Action[]>(() => {
    const base: Action[] = [
      { title: t("nav.brains"), icon: <BrainIcon />, href: `/${locale}/brains` },
      { title: t("nav.connect"), icon: <PlugZapIcon />, href: `/${locale}/connect` },
      { title: t("nav.account"), icon: <UserIcon />, href: `/${locale}/account` },
      { title: t("nav.security"), icon: <ShieldCheckIcon />, href: `/${locale}/account/security` },
    ]
    if (!namespace) return base
    const b = `/${locale}/b/${namespace}`
    return [
      { title: t("nav.overview"), icon: <NetworkIcon />, href: b },
      { title: t("nav.notes"), icon: <StickyNoteIcon />, href: `${b}/notes` },
      { title: t("nav.presentations"), icon: <PresentationIcon />, href: `${b}/presentations` },
      { title: t("nav.chat"), icon: <MessagesSquareIcon />, href: `${b}/chat` },
      { title: t("nav.search"), icon: <SearchIcon />, href: `${b}/search` },
      { title: t("nav.sources"), icon: <PlugIcon />, href: `${b}/sources` },
      { title: t("nav.gaps"), icon: <CircleHelpIcon />, href: `${b}/gaps` },
      { title: t("nav.activity"), icon: <ActivityIcon />, href: `${b}/activity` },
      ...base,
    ]
  }, [t, locale, namespace])

  /*
  Scope, mapped from mark-it-down's Workspace / Current file toggle.

  The literal translation would be "all brains" / "this note", but searching
  inside the one note already on screen is close to useless — Ctrl+F does it
  better. The genuinely useful axis here is the brain boundary, so "This brain"
  narrows to the open namespace and "All brains" drops the filter. Tab switches,
  as the footer says.

  Scoped to the brain only makes sense when there IS one; on /account or
  /brains the toggle would be a no-op, so it hides itself.
  */
  const [scope, setScope] = useState<"brain" | "all">(namespace ? "brain" : "all")
  useEffect(() => setScope(namespace ? "brain" : "all"), [namespace])

  const [recent, setRecent] = useState<RecentNote[]>([])
  // Read on open rather than on mount: the list changes as notes are opened
  // behind the panel, and a stale RECENT section is worse than none.
  useEffect(() => {
    if (open) setRecent(loadRecent())
  }, [open])

  // Debounced brain search. An empty query clears rather than searching.
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const mine = ++seq.current
    const timer = setTimeout(async () => {
      try {
        const scoped = scope === "brain" && namespace ? [namespace] : undefined
        const res = await brainApi.search({ query: q, namespaces: scoped, limit: 8 })
        if (seq.current === mine) setResults(res.results ?? [])
      } catch {
        // A failed search should not replace the action list with an error;
        // the empty state covers it.
        if (seq.current === mine) setResults([])
      } finally {
        if (seq.current === mine) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, namespace, scope])

  function go(href: string) {
    onOpenChange(false)
    router.push(href)
  }

  function openHit(hit: Recalled) {
    onOpenChange(false)
    // Memories carry their note id in source_ref as note:<id>#<chunk>.
    const noteId = hit.sourceRef?.startsWith("note:") ? hit.sourceRef.slice(5).split("#")[0] : undefined
    const ns = hit.namespace ?? namespace
    if (noteId && ns) router.push(`/${locale}/b/${ns}/notes?note=${encodeURIComponent(noteId)}`)
    else if (ns) router.push(`/${locale}/b/${ns}/search?q=${encodeURIComponent(query)}`)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("spotlight.label")}
      description={t("spotlight.description")}
    >
      {/* cmdk filters client-side by default; brain results are already ranked
          by the server, so keep their order and filter the action list by hand. */}
      <Command
        shouldFilter={false}
        onKeyDown={(e) => {
          // Tab switches scope, as the footer advertises. Only when there is a
          // brain to narrow to; otherwise leave Tab to the browser.
          if (e.key === "Tab" && namespace) {
            e.preventDefault()
            setScope((s) => (s === "brain" ? "all" : "brain"))
          }
        }}
      >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("spotlight.placeholder")}
      />

      {namespace ? (
        <div className="flex gap-1 border-b border-line px-3 pb-2">
          {(["brain", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={scope === s}
              onClick={() => setScope(s)}
              className={`rounded-md px-2.5 py-1 text-xs transition ${
                scope === s ? "bg-grid-soft font-medium text-grid-fg" : "text-grid-muted hover:text-grid-fg"
              }`}
            >
              {s === "brain" ? t("spotlight.scopeBrain") : t("spotlight.scopeAll")}
            </button>
          ))}
        </div>
      ) : null}

      <CommandList>
        <CommandEmpty>
          {searching ? t("spotlight.searching") : query.trim() ? t("spotlight.empty") : t("spotlight.hint")}
        </CommandEmpty>

        {/* RECENT only when idle: once a query is typed, results are what the
            user asked for and a recents list is just noise above them. */}
        {!query.trim() && recent.length > 0 ? (
          <>
            <CommandGroup heading={t("spotlight.recent")}>
              {recent.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`recent:${r.id}`}
                  onSelect={() => {
                    onOpenChange(false)
                    router.push(`/${locale}/b/${r.namespace}/notes?id=${encodeURIComponent(r.id)}`)
                  }}
                >
                  <RecentIcon r={r} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" style={{ unicodeBidi: "plaintext" }}>
                      {r.title || t("notes.untitled")}
                    </span>
                    <span className="block truncate text-xs text-grid-muted">{r.namespace}</span>
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
                  <StickyNoteIcon />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{hit.content.slice(0, 120)}</span>
                    <span className="block truncate text-xs text-grid-muted">
                      {hit.namespace ?? namespace} · {hit.memoryType}
                    </span>
                  </span>
                  <KbdGroup>
                    <Kbd><CornerDownLeftIcon className="size-3" /></Kbd>
                  </KbdGroup>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}

        <CommandGroup heading={t("spotlight.goTo")}>
          {actions
            .filter((a) => {
              const q = query.trim().toLowerCase()
              if (!q) return true
              return a.title.toLowerCase().includes(q) || a.keywords?.some((k) => k.includes(q))
            })
            .map((action) => (
              <CommandItem key={action.href} value={action.href} onSelect={() => go(action.href)}>
                {action.icon}
                {action.title}
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>

      {/* Keyboard hints, as in mark-it-down's spotlight. Tab is only listed
          when it does something. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-xs text-grid-muted">
        <Hint keys={["↑", "↓"]} label={t("spotlight.navigate")} />
        <Hint keys={["Enter"]} label={t("spotlight.open")} />
        {namespace ? <Hint keys={["Tab"]} label={t("spotlight.switchScope")} /> : null}
        <Hint keys={["Esc"]} label={t("spotlight.close")} />
      </div>
      </Command>
    </CommandDialog>
  )
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <KbdGroup>
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </KbdGroup>
      {label}
    </span>
  )
}

/** A recent note's derived icon (MH-264), falling back for older entries. */
function RecentIcon({ r }: { r: RecentNote }) {
  const { Icon, color } = noteIcon(r.category)
  return <Icon style={{ color }} />
}
