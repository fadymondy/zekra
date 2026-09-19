"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { DownloadIcon, ExternalLinkIcon, TrashIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SectionHeader } from "@/components/page"
import { Ltr } from "@/components/copy-field"
import { EmptyState, ErrorState, LoadingRows } from "@/components/states"
import { ApiError, brainApi, type NamespaceInfo } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { useBrain, useBrains } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

export default function AdminBrainsPage() {
  const { t, formatNumber } = useTranslations()
  useDocumentTitle(t("nav.allBrains"))
  const brains = useBrains()
  const [deleting, setDeleting] = useState<string | null>(null)

  const list = [...(brains.data ?? [])].sort((a, b) => b.memories - a.memories)

  return (
    <>
      <SectionHeader
        micro={t("admin.micro")}
        title={t("nav.allBrains")}
        description={t("admin.brains.hint")}
        action={list.length ? <span className="text-sm text-grid-muted">{t("admin.brains.count", { n: formatNumber(list.length) })}</span> : null}
      />

      {brains.error ? (
        <ErrorState error={brains.error} />
      ) : brains.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.length === 0 ? (
        <EmptyState title={t("admin.brains.empty")} body={t("admin.brains.emptyBody")} />
      ) : (
        <div className="border-y border-line">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="ps-6">{t("admin.brains.brain")}</TableHead>
                <TableHead className="text-end">{t("admin.brains.memories")}</TableHead>
                <TableHead className="text-end">{t("admin.brains.types")}</TableHead>
                <TableHead className="text-end">{t("admin.brains.recalls")}</TableHead>
                <TableHead>{t("admin.brains.lastActivity")}</TableHead>
                <TableHead>{t("admin.brains.gaps")}</TableHead>
                <TableHead className="pe-6 text-end">
                  <span className="sr-only">{t("common.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((b) => (
                <BrainRow key={b.namespace} b={b} onDelete={() => setDeleting(b.namespace)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DeleteBrainDialog namespace={deleting} onClose={() => setDeleting(null)} onDeleted={() => brains.mutate()} />
    </>
  )
}

function BrainRow({ b, onDelete }: { b: NamespaceInfo; onDelete: () => void }) {
  const { t, locale, formatNumber, formatDate, timeAgo } = useTranslations()
  const d = useBrain(b.namespace).data
  const href = `/${locale}/b/${encodeURIComponent(b.namespace)}`
  const last = d?.lastAt || b.lastAt
  return (
    <TableRow>
      <TableCell className="ps-6">
        <Link href={href} className="font-medium hover:underline">
          <Ltr mono>{b.namespace}</Ltr>
        </Link>
      </TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(d?.memories ?? b.memories)}</TableCell>
      <TableCell className="text-end tabular-nums">{d ? formatNumber(Object.keys(d.types ?? {}).length) : "—"}</TableCell>
      <TableCell className="text-end tabular-nums">{d ? formatNumber(d.recalls) : "—"}</TableCell>
      <TableCell className="text-grid-muted">
        <span title={formatDate(last, { dateStyle: "medium", timeStyle: "short" })}>{timeAgo(last)}</span>
      </TableCell>
      <TableCell>
        {!d ? (
          "—"
        ) : d.openGaps > 0 ? (
          <Badge variant="outline" className="text-grid-warn-text">
            {t("admin.brains.openGaps", { n: formatNumber(d.openGaps) })}
          </Badge>
        ) : (
          <span className="text-xs text-grid-muted">{t("admin.brains.noGaps")}</span>
        )}
      </TableCell>
      <TableCell className="pe-6">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={href} />}>
            <ExternalLinkIcon className="rtl:-scale-x-100" />
            {t("admin.brains.open")}
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<a href={brainApi.exportUrl(b.namespace)} download />}>
            <DownloadIcon />
            {t("admin.brains.export")}
          </Button>
          <Button variant="ghost" size="sm" className="text-grid-danger-text" onClick={onDelete}>
            <TrashIcon />
            {t("common.delete")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Deleting a brain drops every memory in it, so the admin types the namespace to confirm. */
function DeleteBrainDialog({ namespace, onClose, onDeleted }: { namespace: string | null; onClose: () => void; onDeleted: () => void }) {
  const { t, formatNumber } = useTranslations()
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setTyped("")
    setError(null)
    onClose()
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!namespace || typed !== namespace) return
    setBusy(true)
    setError(null)
    try {
      const r = await brainApi.deleteBrain({ namespace, confirm: typed })
      toast.success(t("admin.brains.deleted", { name: namespace, n: formatNumber(r.deleted ?? 0) }))
      onDeleted()
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={namespace !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-grid-danger-text">{t("admin.brains.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("admin.brains.deleteBody")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-brain-confirm">
              {t("admin.brains.typeToConfirm")} <Ltr mono className="text-grid-fg">{namespace}</Ltr>
            </FieldLabel>
            <Input
              id="delete-brain-confirm"
              dir="ltr"
              autoComplete="off"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="font-mono"
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || typed !== namespace}>
              {busy ? t("common.working") : t("admin.brains.deleteConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
