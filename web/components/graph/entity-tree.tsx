"use client"

import { useCallback, useState } from "react"
import { AlertCircleIcon, ChevronRightIcon, Loader2Icon, RefreshCwIcon, RotateCcwIcon } from "lucide-react"

import { api } from "@/lib/api"
import {
  blockedReason,
  childrenOf,
  expandable,
  rootNode,
  rowKey,
  type GraphEdge,
  type TreeNode,
} from "@/lib/graph/tree"
import { cn } from "@/lib/utils"

/*
A collapsible explorer over the entity graph (MH-217).

The graph-to-tree projection — direction, cycles, diamonds, depth — lives in
lib/graph/tree.ts with its own tests; this file is the rendering and the
fetching only.

Expansion is LAZY: a node's edges are fetched when it is first disclosed and
cached thereafter. A brain with thousands of entities must not fetch them all
to draw a sidebar, and each level costs a request.
*/

type EdgeCache = Record<string, GraphEdge[]>

/*
The two seams that make this component mountable outside the web console.

It is shared with the Electron renderer, which talks cross-origin to
app.zekra.dev with a Bearer token through its own client, and which has no
next-intl provider — so neither the web's api() nor useTranslations() can be
imported here. Both are injected, defaulting to the web behaviour so the web
call site stays a plain <EntityTree namespace roots />.
*/

/** Fetches one node's outgoing edges. Rejecting surfaces as a per-row retry. */
export type LoadEdges = (namespace: string, entityId: string) => Promise<GraphEdge[]>

/** The web's loader: same-origin /api with the CSRF token the write guard wants. */
const defaultLoadEdges: LoadEdges = async (namespace, entity) => {
  // `json` rather than a hand-built body: the client sets the content type
  // and attaches the CSRF token the brain's write guard requires.
  const res = await api<{ edges: GraphEdge[] }>("/api/brain/graph/neighbors", { json: { namespace, entity } })
  return res.edges ?? []
}

export interface TreeLabels {
  title: string
  empty: string
  refresh: string
  expand: string
  collapse: string
  cycle: string
  deep: string
  retry: string
  noChildren: string
}

export const DEFAULT_TREE_LABELS: TreeLabels = {
  title: "Tree",
  empty: "Nothing to show yet.",
  refresh: "Refresh",
  expand: "Expand",
  collapse: "Collapse",
  cycle: "Already shown higher up",
  deep: "MAX",
  retry: "Retry",
  noChildren: "No children.",
}

export function EntityTree({
  namespace,
  roots,
  activeId,
  onSelect,
  onRefresh,
  loadEdges = defaultLoadEdges,
  labels,
}: {
  namespace: string
  /** Entity ids to show at the top level. */
  roots: string[]
  activeId?: string | null
  onSelect?: (entityId: string) => void
  onRefresh?: () => void
  /** Override the fetch — required outside the web console. */
  loadEdges?: LoadEdges
  labels?: Partial<TreeLabels>
}) {
  const l = { ...DEFAULT_TREE_LABELS, ...labels }
  const [edges, setEdges] = useState<EdgeCache>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, string>>({})

  const fetchEdges = useCallback(
    async (entityId: string) => {
      setLoading((s) => ({ ...s, [entityId]: true }))
      setFailed((s) => {
        const { [entityId]: _drop, ...rest } = s
        return rest
      })
      try {
        const loaded = await loadEdges(namespace, entityId)
        setEdges((s) => ({ ...s, [entityId]: loaded }))
      } catch (err) {
        // Recorded per node so one unreachable branch does not blank the tree.
        setFailed((s) => ({ ...s, [entityId]: err instanceof Error ? err.message : "failed" }))
      } finally {
        setLoading((s) => ({ ...s, [entityId]: false }))
      }
    },
    [namespace, loadEdges],
  )

  const toggle = useCallback(
    (node: TreeNode) => {
      const key = rowKey(node)
      const next = !open[key]
      setOpen((s) => ({ ...s, [key]: next }))
      // Fetch once per entity, not once per row: a diamond's two rows share
      // the same neighbours.
      if (next && !edges[node.id] && !loading[node.id]) void fetchEdges(node.id)
    },
    [open, edges, loading, fetchEdges],
  )

  if (roots.length === 0) {
    return <p className="px-3 py-4 text-sm text-grid-muted">{l.empty}</p>
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-mono text-xs tracking-wider text-grid-muted uppercase">{l.title}</span>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            aria-label={l.refresh}
            className="rounded-sm p-1 text-grid-muted hover:bg-grid-soft hover:text-grid-fg"
          >
            <RefreshCwIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <ul role="tree" className="min-h-0 flex-1 overflow-y-auto py-1">
        {roots.map((id) => (
          <Row
            key={id}
            node={rootNode(id)}
            edges={edges}
            open={open}
            loading={loading}
            failed={failed}
            activeId={activeId}
            onToggle={toggle}
            onSelect={onSelect}
            onRetry={fetchEdges}
            labels={l}
          />
        ))}
      </ul>
    </div>
  )
}

function Row({
  node,
  edges,
  open,
  loading,
  failed,
  activeId,
  onToggle,
  onSelect,
  onRetry,
  labels,
}: {
  node: TreeNode
  edges: EdgeCache
  open: Record<string, boolean>
  loading: Record<string, boolean>
  failed: Record<string, string>
  activeId?: string | null
  onToggle: (node: TreeNode) => void
  onSelect?: (entityId: string) => void
  onRetry: (entityId: string) => void
  labels: TreeLabels
}) {
  const l = labels
  const key = rowKey(node)
  const isOpen = !!open[key]
  const canExpand = expandable(node)
  const blocked = blockedReason(node)
  const kids = isOpen ? childrenOf(node, edges[node.id] ?? []) : []

  return (
    <li role="treeitem" aria-expanded={canExpand ? isOpen : undefined}>
      <div
        className={cn(
          "flex items-center gap-1 py-1 pe-2 text-sm",
          activeId === node.id ? "bg-grid-action text-grid-on-action" : "hover:bg-grid-soft",
        )}
        // Indent by depth; the chevron column keeps rows aligned whether or
        // not a node can expand.
        style={{ paddingInlineStart: `${0.5 + node.depth * 0.85}rem` }}
      >
        <button
          type="button"
          onClick={() => canExpand && onToggle(node)}
          aria-label={isOpen ? l.collapse : l.expand}
          disabled={!canExpand}
          className="shrink-0 rounded-sm p-0.5 disabled:opacity-0"
        >
          {loading[node.id] && isOpen ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <ChevronRightIcon className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelect?.(node.id)}
          className="min-w-0 flex-1 truncate text-start"
          style={{ unicodeBidi: "plaintext" }}
          title={node.relation ? `${node.relation} → ${node.id}` : node.id}
        >
          {node.id}
        </button>

        {/* A blocked row says why rather than just showing a dead chevron. */}
        {blocked === "cycle" ? (
          <RotateCcwIcon className="size-3 shrink-0 text-grid-muted" aria-label={l.cycle} />
        ) : blocked === "depth" ? (
          <span className="shrink-0 font-mono text-[12px] text-grid-muted">{l.deep}</span>
        ) : null}
      </div>

      {isOpen && failed[node.id] ? (
        <div
          className="flex items-center gap-1.5 py-1 text-xs text-grid-danger"
          style={{ paddingInlineStart: `${1.8 + node.depth * 0.85}rem` }}
        >
          <AlertCircleIcon className="size-3" />
          <span className="truncate">{failed[node.id]}</span>
          <button type="button" onClick={() => onRetry(node.id)} className="underline underline-offset-2">
            {l.retry}
          </button>
        </div>
      ) : null}

      {isOpen && !failed[node.id] && edges[node.id] && kids.length === 0 ? (
        <p
          className="py-1 text-xs text-grid-muted"
          style={{ paddingInlineStart: `${1.8 + node.depth * 0.85}rem` }}
        >
          {l.noChildren}
        </p>
      ) : null}

      {kids.length > 0 ? (
        <ul role="group">
          {kids.map((child) => (
            <Row
              key={rowKey(child)}
              node={child}
              edges={edges}
              open={open}
              loading={loading}
              failed={failed}
              activeId={activeId}
              onToggle={onToggle}
              onSelect={onSelect}
              onRetry={onRetry}
              labels={l}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
