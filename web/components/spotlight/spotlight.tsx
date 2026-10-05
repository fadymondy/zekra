"use client"

import { openConnectAgent } from "@/components/shell/connect-agent"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ActivityIcon,
  BrainIcon,
  CircleHelpIcon,
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
  CommandPalette,
  SearchTrigger,
  useCommandPaletteOpen,
  useRegisterCommandSource,
  useRegisterCommands,
  type Command,
  type CommandSource,
} from "@fadymondy/nasaq/web"

import { brainApi, type Recalled } from "@/lib/api"
import { noteIcon } from "@/lib/notes/note-icon"
import { loadRecent, type RecentNote } from "@/lib/notes/recent-notes"
import { useTranslations } from "@/lib/i18n"

/*
Spotlight: Nasaq's CommandPalette (Ctrl/Cmd+K, or the header trigger) fed by this app's data. It
registers the destinations ("Go to"), the recently opened notes, and brain search through Zekra's
hybrid recall engine (POST /api/brain/search), so results are semantic, not a title filter. Inside
a brain the results are split into "This brain" and "All brains" (the other brains only), which
replaces the old Tab scope toggle.
*/

const DEBOUNCE_MS = 220

/** The sidebar's "Search… ⌘K" field; it opens the palette mounted by `Spotlight`. */
export function SpotlightTrigger() {
  const { t } = useTranslations()
  return <SearchTrigger label={t("spotlight.label")} />
}

export function Spotlight({ namespace }: { namespace?: string }) {
  const { t } = useTranslations()
  return (
    <>
      <SpotlightCommands namespace={namespace} />
      <CommandPalette
        labels={{ title: t("spotlight.label") }}
        placeholder={t("spotlight.placeholder")}
        emptyLabel={t("spotlight.empty")}
      />
    </>
  )
}

function SpotlightCommands({ namespace }: { namespace?: string }) {
  const router = useRouter()
  const { t, locale } = useTranslations()
  const [open] = useCommandPaletteOpen()
  const [recent, setRecent] = useState<RecentNote[]>([])

  // Read on open rather than on mount: notes are opened behind the palette, and a stale
  // recent list is worse than none.
  useEffect(() => {
    if (open) setRecent(loadRecent())
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href)
    const base: Command[] = [
      { id: "zekra.go.brains", section: "navigation", label: t("nav.brains"), icon: BrainIcon, perform: go(`/${locale}/brains`) },
      { id: "zekra.go.connect", section: "navigation", label: t("nav.connect"), icon: PlugZapIcon, perform: openConnectAgent },
      { id: "zekra.go.account", section: "navigation", label: t("nav.account"), icon: UserIcon, perform: go(`/${locale}/account`) },
      { id: "zekra.go.security", section: "navigation", label: t("nav.security"), icon: ShieldCheckIcon, perform: go(`/${locale}/account/security`) },
    ]
    const list: Command[] = []
    if (namespace) {
      const b = `/${locale}/b/${namespace}`
      list.push(
        { id: "zekra.go.overview", section: "navigation", label: t("nav.overview"), icon: NetworkIcon, perform: go(b) },
        { id: "zekra.go.notes", section: "navigation", label: t("nav.notes"), icon: StickyNoteIcon, perform: go(`${b}/notes`) },
        { id: "zekra.go.presentations", section: "navigation", label: t("nav.presentations"), icon: PresentationIcon, perform: go(`${b}/presentations`) },
        { id: "zekra.go.chat", section: "navigation", label: t("nav.chat"), icon: MessagesSquareIcon, perform: go(`${b}/chat`) },
        { id: "zekra.go.search", section: "navigation", label: t("nav.search"), icon: SearchIcon, perform: go(`${b}/search`) },
        { id: "zekra.go.sources", section: "navigation", label: t("nav.sources"), icon: PlugIcon, perform: go(`${b}/sources`) },
        { id: "zekra.go.gaps", section: "navigation", label: t("nav.gaps"), icon: CircleHelpIcon, perform: go(`${b}/gaps`) },
        { id: "zekra.go.activity", section: "navigation", label: t("nav.activity"), icon: ActivityIcon, perform: go(`${b}/activity`) },
      )
    }
    list.push(...base)
    for (const r of recent) {
      const { Icon } = noteIcon(r.category)
      list.push({
        id: `zekra.recent.${r.id}`,
        section: "recent",
        sectionLabel: t("spotlight.recent"),
        sectionOrder: 0.5,
        label: r.title || t("notes.untitled"),
        hint: r.namespace,
        icon: Icon,
        perform: go(`/${locale}/b/${r.namespace}/notes?id=${encodeURIComponent(r.id)}`),
      })
    }
    return list
  }, [t, locale, namespace, recent, router])
  useRegisterCommands(commands)

  const toCommand = useMemo(
    () => (hit: Recalled, section: string, label: string, order: number): Command => {
      const ns = hit.namespace ?? namespace
      // Memories carry their note id in source_ref as note:<id>#<chunk>.
      const noteId = hit.sourceRef?.startsWith("note:") ? hit.sourceRef.slice(5).split("#")[0] : undefined
      return {
        id: `zekra.hit.${hit.id}`,
        section,
        sectionLabel: label,
        sectionOrder: order,
        label: hit.content.slice(0, 120),
        hint: `${ns ?? ""} · ${hit.memoryType}`,
        icon: StickyNoteIcon,
        perform: () => {
          if (noteId && ns) router.push(`/${locale}/b/${ns}/notes?note=${encodeURIComponent(noteId)}`)
          else if (ns) router.push(`/${locale}/b/${ns}/search`)
        },
      }
    },
    [namespace, router, locale],
  )

  const source = useMemo<CommandSource>(
    () => ({
      id: "zekra.memories",
      minQuery: 1,
      debounce: DEBOUNCE_MS,
      search: async (query, signal) => {
        const scoped = namespace ? [namespace] : undefined
        const run = async (namespaces?: string[]) => {
          const res = await brainApi.search({ query, namespaces, limit: 8 })
          return res.results ?? []
        }
        try {
          if (!namespace) {
            const all = await run()
            if (signal.aborted) return []
            return all.map((h) => toCommand(h, "memories", t("spotlight.memories"), 1))
          }
          const [mine, all] = await Promise.all([run(scoped), run()])
          if (signal.aborted) return []
          return [
            ...mine.map((h) => toCommand(h, "memories-brain", t("spotlight.scopeBrain"), 1)),
            ...all.filter((h) => h.namespace !== namespace).map((h) => toCommand(h, "memories-all", t("spotlight.scopeAll"), 2)),
          ]
        } catch {
          // A failed search should not replace the action list with an error;
          // the empty state covers it.
          return []
        }
      },
    }),
    [namespace, t, toCommand],
  )
  useRegisterCommandSource(source)
  return null
}
