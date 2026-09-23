"use client"

// A node's links (graph edges), editable: retype via the relation select, remove, and
// "+ Add link" (entity picker + relation + direction). Edges authored by a note's [[wikilinks]]
// or by extraction are locked (the server 409s): edit the note instead. Shared by the graph
// inspector and the notes editor.
import { useMemo, useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, LockIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { normalizeType } from "@/components/graph/category-picker"
import { EntityPicker } from "@/components/graph/entity-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  entityKey,
  graphApi,
  isLockedEdge,
  refreshGraph,
  useEntity,
  useOntology,
  useReadOnly,
  writeErrorMessage,
  type Entity,
  type EntityEdge,
} from "@/lib/graph-edit"
import { useTranslations } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const NEW = "__new__"

/** A relation select over the ontology's edge types, with "+ New relation". */
function RelationSelect({
  namespace,
  value,
  onChange,
  disabled,
  className,
}: {
  namespace: string
  value: string
  onChange: (rel: string, created: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslations()
  const onto = useOntology(namespace)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const types = useMemo(() => {
    const names = (onto.data?.edgeTypes ?? []).map((x) => x.name)
    if (value && !names.includes(value)) names.push(value)
    return names.sort()
  }, [onto.data, value])
  const items = useMemo(
    () => [...types.map((n) => ({ value: n, label: n })), { value: NEW, label: t("graph.newRelation") }],
    [types, t],
  )

  if (adding) {
    const commit = () => {
      const name = normalizeType(draft)
      setAdding(false)
      setDraft("")
      if (name) onChange(name, !types.includes(name))
    }
    return (
      <Input
        autoFocus
        dir="auto"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") setAdding(false)
        }}
        placeholder={t("graph.newRelationPlaceholder")}
        aria-label={t("graph.newRelation")}
        className={cn("h-7 text-xs", className)}
      />
    )
  }

  return (
    <Select
      items={items}
      value={value || null}
      disabled={disabled}
      onValueChange={(v) => {
        const s = String(v ?? "")
        if (s === NEW) setAdding(true)
        else if (s) onChange(s, false)
      }}
    >
      <SelectTrigger size="sm" aria-label={t("graph.relation")} className={cn("h-7 text-xs", className)}>
        <SelectValue placeholder={t("graph.relation")} />
      </SelectTrigger>
      <SelectContent>
        {types.map((n) => (
          <SelectItem key={n} value={n}>
            <span dir="ltr" className="font-mono text-xs">
              {n}
            </span>
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={NEW}>
          <PlusIcon className="size-3.5" /> {t("graph.newRelation")}
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

export function NodeLinks({
  namespace,
  entityId,
  onOpenNode,
  compact,
}: {
  namespace: string
  entityId: string
  /** Click on the other endpoint (focus it in the graph, or open its note). */
  onOpenNode?: (e: { id: string; name: string; type: string; noteId?: string }) => void
  compact?: boolean
}) {
  const { t, formatNumber } = useTranslations()
  const { mutate } = useSWRConfig()
  const readOnly = useReadOnly(namespace)
  const key = entityKey(entityId)
  const [adding, setAdding] = useState(false)

  // SWR dedupes this with the inspector's own load of the entity.
  const detail = useEntity(entityId).data
  const edges = useMemo(() => detail?.edges ?? [], [detail])

  const fail = (err: unknown) =>
    toast.error(writeErrorMessage(namespace, err, t("common.networkError"), t("graph.lockedEdge")))

  /** Optimistic edit of the cached entity's edge list, then the call, then a revalidate. */
  async function edit(next: (list: EntityEdge[]) => EntityEdge[], call: () => Promise<unknown>) {
    const prev = detail
    if (prev) void mutate(key, { ...prev, edges: next(prev.edges ?? []) }, { revalidate: false })
    try {
      await call()
    } catch (err) {
      if (prev) void mutate(key, prev, { revalidate: false })
      fail(err)
    } finally {
      void mutate(key)
      refreshGraph(namespace)
    }
  }

  const retype = (e: EntityEdge, relation: string, created: boolean) =>
    edit(
      (l) => l.map((x) => (x.id === e.id ? { ...x, relation, label: relation.replace(/_/g, " ") } : x)),
      () => graphApi.updateEdge(e.id, { relation, create_type: created }),
    )

  const remove = (e: EntityEdge) =>
    edit(
      (l) => l.filter((x) => x.id !== e.id),
      () => graphApi.deleteEdge(e.id),
    )

  if (!detail) return null

  return (
    <div>
      <div className="grid-micro mb-2 flex items-center gap-1.5">
        {t("graph.links")} <span>{formatNumber(edges.length)}</span>
        {!readOnly && !adding ? (
          <Button variant="ghost" size="xs" className="ms-auto" onClick={() => setAdding(true)}>
            <PlusIcon /> {t("graph.addLink")}
          </Button>
        ) : null}
      </div>

      {adding ? (
        <AddLink
          namespace={namespace}
          entityId={entityId}
          onCancel={() => setAdding(false)}
          onAdd={async (other, relation, created, outgoing) => {
            setAdding(false)
            const optimistic: EntityEdge = {
              id: `tmp-${Date.now()}`,
              relation,
              label: relation.replace(/_/g, " "),
              direction: outgoing ? "out" : "in",
              weight: 1,
              origin: "manual",
              otherId: other.id,
              otherName: other.name,
              otherType: other.type,
              otherNoteId: other.noteId,
              validFrom: new Date().toISOString(),
            }
            await edit(
              (l) => [optimistic, ...l],
              () =>
                graphApi.createEdge({
                  namespace,
                  src_id: outgoing ? entityId : other.id,
                  dst_id: outgoing ? other.id : entityId,
                  relation,
                  create_type: created,
                }),
            )
          }}
        />
      ) : null}

      {edges.length === 0 ? (
        <p className="text-xs text-grid-muted">{t("graph.noConnections")}</p>
      ) : (
        <ul className={cn("divide-y divide-line border-y border-line", compact && "max-h-80 overflow-y-auto")}>
          {edges.map((e) => {
            const locked = isLockedEdge(e)
            return (
              <li key={e.id} className="flex items-center gap-1.5 py-1.5">
                <span className="shrink-0 text-grid-muted" title={e.direction === "out" ? t("graph.outgoing") : t("graph.incoming")}>
                  {e.direction === "out" ? (
                    <ArrowRightIcon className="size-3.5 rtl:-scale-x-100" aria-label={t("graph.outgoing")} />
                  ) : (
                    <ArrowLeftIcon className="size-3.5 rtl:-scale-x-100" aria-label={t("graph.incoming")} />
                  )}
                </span>
                {locked || readOnly ? (
                  <span
                    className="inline-flex max-w-[40%] shrink-0 items-center gap-1 truncate font-mono text-[12.5px] text-grid-muted"
                    title={locked ? t("graph.lockedHint") : undefined}
                    dir="ltr"
                  >
                    {locked ? <LockIcon className="size-3 shrink-0" /> : null}
                    {e.relation}
                  </span>
                ) : (
                  <RelationSelect
                    namespace={namespace}
                    value={e.relation}
                    onChange={(rel, created) => rel !== e.relation && retype(e, rel, created)}
                    className="max-w-[45%] shrink-0"
                  />
                )}
                <button
                  type="button"
                  onClick={() =>
                    onOpenNode?.({ id: e.otherId, name: e.otherName, type: e.otherType, noteId: e.otherNoteId })
                  }
                  className="min-w-0 flex-1 truncate text-start text-xs text-grid-fg hover:underline"
                  dir="auto"
                  title={e.fact || e.otherName}
                >
                  {e.otherName}
                </button>
                <span className="shrink-0 text-[12px] text-grid-muted">{e.otherType}</span>
                {!locked && !readOnly ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => remove(e)}
                    aria-label={t("graph.removeLink", { name: e.otherName })}
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {edges.some(isLockedEdge) && !readOnly ? (
        <p className="mt-1.5 flex items-center gap-1 text-[12.5px] text-grid-muted">
          <LockIcon className="size-3" /> {t("graph.lockedHint")}
        </p>
      ) : null}
    </div>
  )
}

function AddLink({
  namespace,
  entityId,
  onAdd,
  onCancel,
}: {
  namespace: string
  entityId: string
  onAdd: (other: Entity, relation: string, created: boolean, outgoing: boolean) => void
  onCancel: () => void
}) {
  const { t } = useTranslations()
  const [other, setOther] = useState<Entity | null>(null)
  const [relation, setRelation] = useState<{ name: string; created: boolean }>({ name: "related_to", created: false })
  const [outgoing, setOutgoing] = useState(true)

  return (
    <div className="mb-3 space-y-2 border border-line bg-grid-bg p-2">
      <EntityPicker
        namespace={namespace}
        exclude={entityId}
        onPick={setOther}
        trigger={
          <Button variant="outline" size="sm" className="w-full justify-start font-normal">
            <span dir="auto" className={cn("truncate", !other && "text-grid-muted")}>
              {other ? other.name : t("graph.pickNode")}
            </span>
          </Button>
        }
      />
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => setOutgoing((o) => !o)}
          aria-label={t("graph.direction")}
          title={outgoing ? t("graph.outgoingHint") : t("graph.incomingHint")}
        >
          {outgoing ? <ArrowRightIcon className="rtl:-scale-x-100" /> : <ArrowLeftIcon className="rtl:-scale-x-100" />}
          {outgoing ? t("graph.outgoing") : t("graph.incoming")}
        </Button>
        <RelationSelect
          namespace={namespace}
          value={relation.name}
          onChange={(name, created) => setRelation({ name, created })}
          className="min-w-0 flex-1"
        />
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <XIcon /> {t("common.cancel")}
        </Button>
        <Button size="sm" disabled={!other} onClick={() => other && onAdd(other, relation.name, relation.created, outgoing)}>
          <PlusIcon /> {t("graph.addLink")}
        </Button>
      </div>
    </div>
  )
}
