/*
The set of notes held open as tabs.

Scoped PER BRAIN. A strip mixing notes from several brains would be ambiguous
— two brains can hold notes with the same title, and closing the last tab of
one brain while standing in another has no sensible meaning. Switching brain
therefore shows that brain's own tabs, which is also what the sidebar implies.

Browser-local, like recents: which tabs are open is a property of this window,
not of the account. Restoring another device's tabs would be surprising.
*/

export interface OpenTab {
  id: string
  title: string
  /** Drives the derived icon (MH-264); absent on tabs stored before it existed. */
  category?: string
}

const KEY_PREFIX = "zekra.open-tabs:"
/**
 * Beyond this the strip stops being navigable and becomes a scrollbar with
 * unreadable labels; the oldest inactive tab is evicted instead.
 */
export const MAX_TABS = 12

const keyFor = (namespace: string) => `${KEY_PREFIX}${namespace}`

export function coerceTabs(raw: unknown): OpenTab[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: OpenTab[] = []
  for (const t of raw) {
    if (!t || typeof t !== "object") continue
    const id = (t as OpenTab).id
    if (typeof id !== "string" || !id || seen.has(id)) continue
    seen.add(id)
    const cat = (t as OpenTab).category
    out.push({
      id,
      title: typeof (t as OpenTab).title === "string" ? (t as OpenTab).title : "",
      ...(typeof cat === "string" && cat ? { category: cat } : {}),
    })
    if (out.length >= MAX_TABS) break
  }
  return out
}

export function loadTabs(namespace: string): OpenTab[] {
  if (!namespace || typeof localStorage === "undefined") return []
  try {
    return coerceTabs(JSON.parse(localStorage.getItem(keyFor(namespace)) ?? "[]"))
  } catch {
    return []
  }
}

function persist(namespace: string, tabs: OpenTab[]): OpenTab[] {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(keyFor(namespace), JSON.stringify(tabs))
    } catch {
      /* quota or private mode — not worth failing a note open over */
    }
  }
  return tabs
}

/**
 * Open a note as a tab, or refresh an existing one's title.
 *
 * Eviction drops the OLDEST tab that is not the one being opened. Evicting by
 * position alone could close the tab the user is switching to.
 */
export function openTab(namespace: string, tab: OpenTab, tabs = loadTabs(namespace)): OpenTab[] {
  const existing = tabs.findIndex((x) => x.id === tab.id)
  if (existing >= 0) {
    // Already open: keep its position (tabs should not jump around) but take
    // the current title, which may have been renamed.
    const next = tabs.slice()
    next[existing] = { ...next[existing], title: tab.title }
    return persist(namespace, next)
  }
  const next = [...tabs, tab]
  while (next.length > MAX_TABS) {
    const victim = next.findIndex((x) => x.id !== tab.id)
    next.splice(victim === -1 ? 0 : victim, 1)
  }
  return persist(namespace, next)
}

export function closeTab(namespace: string, id: string, tabs = loadTabs(namespace)): OpenTab[] {
  return persist(namespace, tabs.filter((x) => x.id !== id))
}

export function renameTab(namespace: string, id: string, title: string, tabs = loadTabs(namespace)): OpenTab[] {
  if (!tabs.some((x) => x.id === id)) return tabs
  return persist(namespace, tabs.map((x) => (x.id === id ? { ...x, title } : x)))
}

/**
 * Which note to select after closing one. Falls to the neighbour on the left,
 * then the right — the behaviour every editor has, so nobody has to learn it.
 */
export function nextSelection(tabs: OpenTab[], closedId: string, activeId: string | null): string | null {
  if (activeId !== closedId) return activeId
  const i = tabs.findIndex((x) => x.id === closedId)
  if (i === -1) return null
  const left = tabs[i - 1]
  const right = tabs[i + 1]
  return left?.id ?? right?.id ?? null
}
