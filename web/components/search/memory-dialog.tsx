"use client"

import { useEffect, useState } from "react"
import { PencilIcon } from "lucide-react"
import { toast } from "sonner"
import useSWR from "swr"

import { ErrorState } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, brainApi, type Recalled } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { noRetryOn4xx } from "@/lib/queries"

/** "Open memory": the full memory row, with an inline edit of its content. */
export function MemoryDialog({
  namespace,
  hit,
  onClose,
  onSaved,
}: {
  namespace: string
  hit: Recalled | null
  onClose: () => void
  onSaved: (id: string, content: string) => void
}) {
  const { t, formatDate, formatNumber } = useTranslations()
  const ns = hit?.namespace || namespace
  const mem = useSWR(hit ? ["/api/brain/memory", ns, hit.id] : null, ([, n, id]: [string, string, string]) => brainApi.getMemory(n, id), noRetryOn4xx)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditing(false)
  }, [hit?.id])

  const content = mem.data?.content ?? hit?.content ?? ""

  async function save() {
    if (!hit) return
    setSaving(true)
    try {
      await brainApi.editMemory({ namespace: ns, id: hit.id, content: draft })
      toast.success(t("search.memorySaved"))
      onSaved(hit.id, draft)
      await mem.mutate()
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setSaving(false)
    }
  }

  const m = mem.data
  const meta: { label: string; value: string | undefined }[] = [
    { label: t("search.network"), value: m?.network ?? hit?.network },
    { label: t("search.type"), value: m?.memoryType ?? hit?.memoryType },
    { label: t("search.source"), value: [m?.sourceKind ?? hit?.sourceKind, m?.sourceRef ?? hit?.sourceRef].filter(Boolean).join(" · ") },
    { label: t("search.visibility"), value: m?.visibility },
  ]

  return (
    <Dialog open={!!hit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("search.memoryTitle")}</DialogTitle>
          <DialogDescription>
            <span dir="ltr" className="font-mono text-xs">
              {ns} · {hit?.id}
            </span>
          </DialogDescription>
        </DialogHeader>

        {mem.error ? <ErrorState error={mem.error} /> : null}

        {editing ? (
          <Textarea dir="auto" value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(14, Math.max(4, draft.split("\n").length))} autoFocus aria-label={t("search.memoryTitle")} />
        ) : !content && mem.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div dir="auto" className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap border border-line bg-grid-card p-3 text-sm leading-relaxed text-grid-fg">
            {content}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          {meta
            .filter((x) => x.value)
            .map((x) => (
              <div key={x.label}>
                <dt className="grid-micro">{x.label}</dt>
                <dd dir="ltr" className="font-mono text-grid-fg">
                  {x.value}
                </dd>
              </div>
            ))}
          {hit ? (
            <div>
              <dt className="grid-micro">{t("search.importance")}</dt>
              <dd className="font-mono text-grid-fg">{formatNumber(m?.importance ?? hit.importance ?? 0, { maximumFractionDigits: 2 })}</dd>
            </div>
          ) : null}
          {m?.validAt || hit?.validAt ? (
            <div>
              <dt className="grid-micro">{t("search.validAt")}</dt>
              <dd className="text-grid-fg">{formatDate(m?.validAt || hit?.validAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
            </div>
          ) : null}
        </dl>
        {hit?.viaEntity ? (
          <Badge variant="outline" className="w-fit">
            {t("search.via", { entity: hit.viaEntity })}
          </Badge>
        ) : null}

        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                {t("common.cancel")}
              </Button>
              <Button onClick={save} disabled={saving || !draft.trim() || draft === content}>
                {saving ? t("common.saving") : t("common.save")}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setDraft(content)
                  setEditing(true)
                }}
              >
                <PencilIcon /> {t("common.edit")}
              </Button>
              <Button onClick={onClose}>{t("common.close")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
