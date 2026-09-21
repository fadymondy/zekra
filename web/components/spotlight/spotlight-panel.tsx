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
        const res = await brainApi.search({ query: q, namespaces: namespace ? [namespace] : undefined, limit: 8 })
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
  }, [query, namespace])

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
      <Command shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t("spotlight.placeholder")}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? t("spotlight.searching") : query.trim() ? t("spotlight.empty") : t("spotlight.hint")}
        </CommandEmpty>

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
      </Command>
    </CommandDialog>
  )
}
