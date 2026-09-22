"use client"

import useSWR from "swr"
import { Loader2Icon } from "lucide-react"

import { EntityTree } from "@/components/graph/entity-tree"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { noRetryOn4xx } from "@/lib/queries"

/*
The notes tree view (MH-217 / MH-306), rooted on the brain's graph spine.

"Which entities are the roots" was the decision that kept this unmounted. The
answer is the spine hubs — the entity types the spine walk expands THROUGH,
ordered by degree — computed server-side by /api/brain/graph/roots so the
client does not have to fetch the graph to find its own starting points.

This file is only the roots fetch and the web's copy; the tree itself
(lazy expansion, cycles, depth) is the shared EntityTree.
*/

type Root = { name: string; type: string; degree: number }

export function NoteTree({
  namespace,
  activeEntity,
  onSelect,
}: {
  namespace: string
  activeEntity?: string | null
  onSelect?: (entity: string) => void
}) {
  const { t } = useTranslations()
  const roots = useSWR<{ roots: Root[]; fallback: boolean }>(
    namespace ? ["/api/brain/graph/roots", namespace] : null,
    () => api("/api/brain/graph/roots", { json: { namespace } }),
    noRetryOn4xx,
  )

  if (roots.isLoading) {
    return (
      <p className="flex items-center gap-2 px-3 py-4 text-sm text-grid-muted">
        <Loader2Icon className="size-3.5 animate-spin" />
      </p>
    )
  }
  if (roots.error) {
    return <p className="px-3 py-4 text-sm text-grid-danger">{roots.error.message}</p>
  }

  return (
    <EntityTree
      namespace={namespace}
      roots={(roots.data?.roots ?? []).map((r) => r.name)}
      activeId={activeEntity}
      onSelect={onSelect}
      onRefresh={() => void roots.mutate()}
      labels={{
        title: t("tree.title"),
        empty: t("tree.empty"),
        refresh: t("common.refresh"),
        expand: t("tree.expand"),
        collapse: t("tree.collapse"),
        cycle: t("tree.cycle"),
        deep: t("tree.deep"),
        retry: t("common.retry"),
        noChildren: t("tree.noChildren"),
      }}
    />
  )
}
