"use client"

import { Badge, Button, InputGroup, InputGroupAddon, InputGroupInput, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@fadymondy/nasaq/web"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react"

import { PageBody, Panel, SectionHeader } from "@/components/page"
import { Ltr } from "@/components/copy-field"
import { EmptyState, LoadingRows } from "@/components/states"
import { AdminErrorState } from "@/components/admin/not-live"
import { UserStatusBadge } from "@/components/admin/user-status"
import { USER_ROLES, useAdminUsers } from "@/lib/admin"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"

export default function AdminUsersPage() {
  const { t, locale, formatDate, formatNumber } = useTranslations()
  useDocumentTitle(t("nav.users"))
  const [input, setInput] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)

  // Debounce the search box; a new query starts again at page 1.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(input.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(id)
  }, [input])

  const users = useAdminUsers(q, page)
  const list = users.data?.users ?? []
  const total = users.data?.total ?? 0
  const perPage = users.data?.perPage ?? 25
  const pages = Math.max(1, Math.ceil(total / perPage))

  return (
    <>
      <SectionHeader micro={t("admin.micro")} title={t("nav.users")} description={t("admin.users.hint")} />
      <PageBody>

      <Panel>
      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full max-w-sm">
          <InputGroupAddon>
            <SearchIcon aria-hidden className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={t("admin.users.search")}
            placeholder={t("admin.users.searchPlaceholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </InputGroup>
        {users.data ? (
          <span className="ms-auto text-xs text-muted-foreground">{t("admin.users.count", { n: formatNumber(total) })}</span>
        ) : null}
      </div>

      {users.error ? (
        <AdminErrorState error={users.error} what={t("admin.users.notLive")} />
      ) : users.isLoading ? (
        <LoadingRows rows={5} />
      ) : list.length === 0 ? (
        <EmptyState title={q ? t("admin.users.noMatch") : t("admin.users.empty")} />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">{t("admin.users.email")}</TableHead>
                  <TableHead>{t("admin.users.name")}</TableHead>
                  <TableHead>{t("admin.users.roles")}</TableHead>
                  <TableHead>{t("admin.users.status")}</TableHead>
                  <TableHead className="pe-4">{t("admin.users.joined")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((u) => (
                  <TableRow key={u.id} className={u.disabled ? "opacity-60" : undefined}>
                    <TableCell className="ps-4">
                      <Link href={`/${locale}/admin/users/${encodeURIComponent(String(u.id))}`} className="font-medium hover:underline">
                        <Ltr>{u.email}</Ltr>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground" dir="auto">
                      {u.name || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(u.roles.length ? u.roles : ["member"]).map((r) => (
                          <Badge key={r} variant="outline">
                            {(USER_ROLES as readonly string[]).includes(r) ? t(`admin.role.${r}`) : <Ltr>{r}</Ltr>}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge user={u} />
                    </TableCell>
                    <TableCell className="pe-4 text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeftIcon className="rtl:rotate-180" />
                {t("admin.users.prev")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t("admin.users.page", { n: formatNumber(page), total: formatNumber(pages) })}
              </span>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t("admin.users.next")}
                <ChevronRightIcon className="rtl:rotate-180" />
              </Button>
            </div>
          ) : null}
        </>
      )}
      </Panel>
      </PageBody>
    </>
  )
}
