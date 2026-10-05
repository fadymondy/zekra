"use client"

// The brain's memory graph on Nasaq's GraphView: each entity type is a kind with its own colour, so the
// toolbar's category filters, search, inspector and graph/grid/list/schema modes all come from Nasaq.
import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { GraphView, TAG_HUES, type GraphViewKind, type GraphViewLink, type GraphViewNode, type TagHue } from "@fadymondy/nasaq/web"

import type { GraphData } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"

const HUES = TAG_HUES.filter((h) => h !== "gray") as TagHue[]

const kindOf = (n: { type?: string; group?: string }) => n.type || n.group || "other"

export function NasaqBrainGraph({
  data,
  base,
  brain,
  focusId,
  focusNoteId,
  height,
}: {
  data: GraphData
  base: string
  brain: string
  focusId?: string | null
  focusNoteId?: string | null
  height?: number | string
}) {
  const { t } = useTranslations()
  const router = useRouter()

  const { nodes, links, kinds } = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of data.nodes) counts.set(kindOf(n), (counts.get(kindOf(n)) ?? 0) + 1)
    // Biggest categories get the first (most distinct) colours.
    const order = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const kinds: GraphViewKind[] = order.map((k, i) => ({
      id: k,
      label: k,
      hue: k === "other" ? "gray" : HUES[i % HUES.length],
      shape: k === "root" ? "hexagon" : k === "type" ? "rounded" : "circle",
    }))
    const ids = new Set(data.nodes.map((n) => n.id))
    const nodes: GraphViewNode[] = data.nodes.map((n) => ({
      id: n.id,
      label: n.name || n.id,
      kind: kindOf(n),
      tags: n.noteId ? ["note"] : undefined,
    }))
    // A brain, not a scatter: every category is a hub wired to the brain's core, every entity hangs off
    // its category hub, and the real relations run between entities. Data "flows" along every link.
    const linked = new Set<string>()
    const links: GraphViewLink[] = data.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => (linked.add(e.source), linked.add(e.target), { ...e, kind: "relation" }))
    const core = "__core__"
    nodes.push({ id: core, label: brain, kind: "__core__", weight: 3 })
    for (const k of order) {
      const hub = `__hub__${k}`
      nodes.push({ id: hub, label: k, kind: k, weight: 2, shape: "hexagon", labelPosition: "bottom" })
      links.push({ source: core, target: hub, kind: "spine" })
    }
    for (const n of data.nodes) links.push({ source: `__hub__${kindOf(n)}`, target: n.id, kind: "member" })
    kinds.unshift({ id: "__core__", label: brain, hue: "violet", shape: "hexagon", labelPosition: "bottom" })
    return { nodes, links, kinds }
  }, [data, brain])

  const noteOf = useMemo(() => new Map(data.nodes.filter((n) => n.noteId).map((n) => [n.id, n.noteId!])), [data])

  return (
    <GraphView
      nodes={nodes}
      links={links}
      kinds={kinds}
      height={height}
      labelPosition="none"
      linkKinds={[
        { id: "spine", style: "flow", hue: "violet" },
        { id: "member", style: "flow" },
        { id: "relation", style: "flow", hue: "teal", arrow: true },
      ]}
      defaultSelectedId={focusId ?? data.nodes.find((n) => focusNoteId && n.noteId === focusNoteId)?.id ?? null}
      onOpen={(n) => {
        if (n.id.startsWith("__")) return
        const note = noteOf.get(n.id)
        router.push(note ? `${base}/notes?id=${encodeURIComponent(note)}` : `${base}/search?q=${encodeURIComponent(n.label)}`)
      }}
      labels={{
        search: t("graph.nq.search"),
        view: t("graph.nq.view"),
        graph: t("graph.nq.graph"),
        grid: t("graph.nq.grid"),
        list: t("graph.nq.list"),
        schema: t("graph.nq.schema"),
        kinds: t("graph.nq.kinds"),
        counts: (n, l) => t("graph.nq.counts", { nodes: n, links: l }),
        zoomIn: t("graph.nq.zoomIn"),
        zoomOut: t("graph.nq.zoomOut"),
        fit: t("graph.nq.fit"),
        graphHint: t("graph.nq.graphHint"),
        open: t("graph.nq.open"),
        close: t("graph.nq.close"),
        linksTo: t("graph.nq.linksTo"),
        linkedFrom: t("graph.nq.linkedFrom"),
        noLinks: t("graph.nq.noLinks"),
        connections: (n) => t("graph.nq.connections", { n }),
        emptyTitle: t("graph.empty"),
        emptyBody: t("graph.nq.emptyBody"),
        clear: t("graph.nq.clear"),
      }}
      className="rounded-xl"
    />
  )
}
