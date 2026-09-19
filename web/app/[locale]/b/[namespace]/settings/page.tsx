"use client"

// Brain settings (Mahaam's settings layout: full-bleed sections split by hairlines, the label
// and hint on the start side, the form on the end side). General + Appearance edit the brain's
// profile (PATCH /api/brain/profile, POST/DELETE /api/brain/profile/image); Members reuses
// /api/brain/members; the danger zone reuses export and brain delete. The namespace id never
// changes; the display name is the rename.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { DownloadIcon, ImageIcon, Loader2Icon, SaveIcon, Trash2Icon, UploadIcon, UserPlusIcon } from "lucide-react"
import { toast } from "sonner"
import { useSWRConfig } from "swr"

import { BrainAvatar } from "@/components/brains/brain-cells"
import { ColorPicker } from "@/components/brains/color-picker"
import { toastError } from "@/components/admin/toast-error"
import { ConfirmButton } from "@/components/confirm-button"
import { Ltr } from "@/components/copy-field"
import { HatchBand, SectionHeader } from "@/components/page"
import { ErrorState, LoadingRows } from "@/components/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, brainApi } from "@/lib/api"
import {
  ACCEPTED_IMAGES,
  prepareImage,
  profileApi,
  useBrainOntology,
  useBrainProfile,
  useMembers,
  type BrainProfile,
  type EditLevel,
  type ImageKind,
  type MemberRole,
  type PaletteColor,
  type ProfilePatch,
} from "@/lib/brain-profile"
import { useTranslations } from "@/lib/i18n"
import { useDocumentTitle } from "@/lib/title"
import { cn } from "@/lib/utils"

const isBrainKey = (key: unknown) => {
  const k = Array.isArray(key) ? key[0] : key
  return typeof k === "string" && k.startsWith("/api/brain/")
}

/** One settings block: title + hint on the start side, content on the end side. */
function Section({ id, title, hint, children, danger }: { id: string; title: string; hint?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t border-line px-6 py-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div>
        <h2 id={id} className={cn("text-base font-medium", danger && "text-grid-danger-text")}>
          {title}
        </h2>
        {hint ? <p className="mt-1 text-sm text-grid-muted">{hint}</p> : null}
      </div>
      <div className="min-w-0 max-w-2xl">{children}</div>
    </section>
  )
}

export default function BrainSettingsPage() {
  const { namespace: raw } = useParams<{ namespace: string }>()
  const ns = decodeURIComponent(raw)
  const { t } = useTranslations()
  useDocumentTitle(`${t("brainSettings.title")} · ${ns}`)
  const q = useBrainProfile(ns)

  if (q.error) {
    return (
      <>
        <SectionHeader micro={<Ltr>{ns}</Ltr>} title={t("brainSettings.title")} />
        <ErrorState error={q.error} />
      </>
    )
  }
  const data = q.data
  return (
    <>
      <SectionHeader micro={<Ltr>{ns}</Ltr>} title={t("brainSettings.title")} description={t("brainSettings.description")} />
      {!data ? (
        <LoadingRows rows={4} />
      ) : (
        <>
          {data.edit === "none" ? (
            <HatchBand>
              <p className="text-sm">{t("brainSettings.readOnly")}</p>
            </HatchBand>
          ) : data.edit === "limited" ? (
            <HatchBand>
              <p className="text-sm">{t("brainSettings.limited")}</p>
            </HatchBand>
          ) : null}
          <GeneralSection key={data.profile.updatedAt ?? "new"} ns={ns} profile={data.profile} edit={data.edit} palette={data.palette} />
          <AppearanceSection ns={ns} profile={data.profile} edit={data.edit} />
          <MembersSection ns={ns} edit={data.edit} />
          <DangerSection ns={ns} edit={data.edit} />
        </>
      )}
    </>
  )
}

// ── General ──────────────────────────────────────────────────────────────────────────

const EMOJI = ["🧠", "📚", "🚀", "💡", "🧪", "🛠️", "📈", "🗂️", "🌍", "🔒", "⚖️", "🎯"]

function GeneralSection({ ns, profile, edit, palette }: { ns: string; profile: BrainProfile; edit: EditLevel; palette: PaletteColor[] }) {
  const { t, locale } = useTranslations()
  const { mutate } = useSWRConfig()
  const onto = useBrainOntology(ns)
  const full = edit === "full"
  const canEdit = edit !== "none"

  const initial = useMemo(
    () => ({
      displayName: profile.persisted && profile.displayName !== ns ? profile.displayName : "",
      description: profile.description,
      icon: profile.icon,
      color: profile.persisted ? profile.color : "",
      defaultNoteCategory: profile.defaultNoteCategory,
      visibility: profile.visibility,
    }),
    [profile, ns],
  )
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => setForm(initial), [initial])
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }))

  const dirty = (Object.keys(form) as (keyof typeof form)[]).filter((k) => form[k] !== initial[k])
  const editable = (k: keyof typeof form) => full || k === "description" || k === "color"
  const categories = (onto.data?.entityTypes ?? []).map((e) => e.name)
  if (form.defaultNoteCategory && !categories.includes(form.defaultNoteCategory)) categories.unshift(form.defaultNoteCategory)
  const NONE = "__none"

  async function save(e: FormEvent) {
    e.preventDefault()
    const patch: ProfilePatch = {}
    for (const k of dirty) if (editable(k)) (patch as Record<string, string>)[k] = form[k]
    if (!Object.keys(patch).length) return
    setBusy(true)
    try {
      await profileApi.update(ns, patch)
      void mutate(isBrainKey)
      toast.success(t("brainSettings.saved"))
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section id="settings-general" title={t("brainSettings.general.title")} hint={t("brainSettings.general.hint")}>
      <form onSubmit={save}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="bs-name">{t("brainSettings.general.displayName")}</FieldLabel>
            <Input
              id="bs-name"
              dir="auto"
              maxLength={80}
              disabled={!full}
              value={form.displayName}
              placeholder={ns}
              onChange={(e) => set("displayName", e.target.value)}
            />
            <FieldDescription>
              {t("brainSettings.general.namespaceHint")} <Ltr mono>{ns}</Ltr>
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="bs-desc">{t("brainSettings.general.description")}</FieldLabel>
            <Textarea
              id="bs-desc"
              dir="auto"
              rows={4}
              maxLength={2000}
              disabled={!canEdit}
              value={form.description}
              placeholder={t("brainSettings.general.descriptionPlaceholder")}
              onChange={(e) => set("description", e.target.value)}
            />
            <FieldDescription>
              {t("brainSettings.general.descriptionHint", { count: String(2000 - form.description.length) })}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="bs-icon">{t("brainSettings.general.icon")}</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <BrainAvatar namespace={ns} profile={{ ...profile, icon: form.icon, imageUrl: "", color: form.color || profile.color, colorHex: "" }} size={36} />
              <Input
                id="bs-icon"
                maxLength={32}
                disabled={!full}
                value={form.icon}
                placeholder="🧠"
                onChange={(e) => set("icon", e.target.value)}
                className="w-28"
              />
              <div className="flex flex-wrap gap-1" role="group" aria-label={t("brainSettings.general.iconSuggestions")}>
                {EMOJI.map((e) => (
                  <button
                    key={e}
                    type="button"
                    disabled={!full}
                    onClick={() => set("icon", e)}
                    aria-label={t("brainSettings.general.useIcon", { icon: e })}
                    className={cn(
                      "flex size-8 items-center justify-center border border-transparent text-base hover:border-line hover:bg-grid-soft disabled:pointer-events-none disabled:opacity-50",
                      form.icon === e && "border-line bg-grid-soft",
                    )}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <FieldDescription>{t("brainSettings.general.iconHint")}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{t("brainSettings.general.color")}</FieldLabel>
            <ColorPicker value={form.color} onChange={(v) => set("color", v)} palette={palette} disabled={!canEdit} />
            <FieldDescription>{t("brainSettings.general.colorHint")}</FieldDescription>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="bs-category">{t("brainSettings.general.defaultCategory")}</FieldLabel>
              <Select
                value={form.defaultNoteCategory || NONE}
                disabled={!full}
                onValueChange={(v) => set("defaultNoteCategory", !v || v === NONE ? "" : String(v))}
              >
                <SelectTrigger id="bs-category" className="w-full">
                  <SelectValue>{(v: string) => (v === NONE ? t("brainSettings.general.noCategory") : v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("brainSettings.general.noCategory")}</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      <Ltr>{c}</Ltr>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t("brainSettings.general.defaultCategoryHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="bs-visibility">{t("brainSettings.general.visibility")}</FieldLabel>
              <Select value={form.visibility} disabled={!full} onValueChange={(v) => v && set("visibility", v as BrainProfile["visibility"])}>
                <SelectTrigger id="bs-visibility" className="w-full">
                  <SelectValue>{(v: string) => t(`brainSettings.visibility.${v}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["private", "internal"] as const).map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`brainSettings.visibility.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t("brainSettings.general.visibilityHint")}</FieldDescription>
            </Field>
          </div>

          {canEdit ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || dirty.length === 0}>
                {busy ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
                {busy ? t("common.saving") : t("common.save")}
              </Button>
              {dirty.length > 0 ? (
                <Button type="button" variant="ghost" onClick={() => setForm(initial)} disabled={busy}>
                  {t("brainSettings.discard")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </FieldGroup>
      </form>
    </Section>
  )
}

// ── Appearance ───────────────────────────────────────────────────────────────────────

function AppearanceSection({ ns, profile, edit }: { ns: string; profile: BrainProfile; edit: EditLevel }) {
  const { t } = useTranslations()
  return (
    <Section id="settings-appearance" title={t("brainSettings.appearance.title")} hint={t("brainSettings.appearance.hint")}>
      <div className="grid gap-8">
        <ImageField ns={ns} kind="image" url={profile.imageUrl} edit={edit} preview={<BrainAvatar namespace={ns} profile={profile} size={80} />} />
        <ImageField
          ns={ns}
          kind="cover"
          url={profile.coverUrl}
          edit={edit}
          preview={
            profile.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- member-only API image
              <img src={profile.coverUrl} alt="" className="aspect-[4/1] w-full max-w-md border border-line object-cover" />
            ) : (
              <div
                className="flex aspect-[4/1] w-full max-w-md items-center justify-center border border-dashed border-line text-grid-muted"
                style={{ backgroundColor: `color-mix(in srgb, ${profile.colorHex} 10%, transparent)` }}
              >
                <ImageIcon className="size-5" />
              </div>
            )
          }
        />
      </div>
    </Section>
  )
}

function ImageField({ ns, kind, url, edit, preview }: { ns: string; kind: ImageKind; url: string; edit: EditLevel; preview: ReactNode }) {
  const { t, locale } = useTranslations()
  const { mutate } = useSWRConfig()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const full = edit === "full"
  const uploaded = url.startsWith("/api/")

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      const prepared = await prepareImage(file, kind)
      if (!prepared) {
        toast.error(t("brainSettings.appearance.invalid"))
        return
      }
      await profileApi.uploadImage(ns, kind, prepared.blob, prepared.name)
      void mutate(isBrainKey)
      toast.success(t("brainSettings.appearance.uploaded"))
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ""
    }
  }

  async function remove() {
    setBusy(true)
    try {
      if (uploaded) await profileApi.removeImage(ns, kind)
      else await profileApi.update(ns, kind === "image" ? { imageUrl: "" } : { coverUrl: "" })
      void mutate(isBrainKey)
      toast.success(t("brainSettings.appearance.removed"))
    } catch (err) {
      toastError(err, locale)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div>
        <h3 className="text-sm font-medium">{t(`brainSettings.appearance.${kind}`)}</h3>
        <p className="mt-0.5 text-xs text-grid-muted">{t(`brainSettings.appearance.${kind}Hint`)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {preview}
        {full ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept={ACCEPTED_IMAGES}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              {url ? t("brainSettings.appearance.replace") : t("brainSettings.appearance.upload")}
            </Button>
            {url ? (
              <Button type="button" variant="ghost" size="sm" className="text-grid-danger-text" disabled={busy} onClick={() => void remove()}>
                <Trash2Icon />
                {t("brainSettings.appearance.remove")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {full ? <p className="text-xs text-grid-muted">{t("brainSettings.appearance.rules")}</p> : null}
    </div>
  )
}

// ── Members ──────────────────────────────────────────────────────────────────────────

const ROLES: MemberRole[] = ["owner", "editor", "viewer"]

function MembersSection({ ns, edit }: { ns: string; edit: EditLevel }) {
  const { t, locale } = useTranslations()
  const full = edit === "full"
  const members = useMembers(ns, full)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("editor")
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true)
    try {
      await fn()
      await members.mutate()
      if (done) toast.success(done)
      return true
    } catch (err) {
      toastError(err, locale)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const v = email.trim()
    if (!v) return
    if (await run(() => profileApi.setMember({ namespace: ns, email: v, role }), t("brainSettings.members.added", { who: v }))) setEmail("")
  }

  const roleItems = ROLES.map((r) => ({ value: r, label: t(`brainSettings.role.${r}`) }))

  return (
    <Section id="settings-members" title={t("brainSettings.members.title")} hint={t("brainSettings.members.hint")}>
      {!full ? (
        <p className="text-sm text-grid-muted">{t("brainSettings.members.ownerOnly")}</p>
      ) : members.error ? (
        <ErrorState error={members.error} />
      ) : (
        <div className="grid gap-6">
          <form onSubmit={add}>
            <FieldGroup className="sm:flex-row sm:items-end">
              <Field className="sm:flex-1">
                <FieldLabel htmlFor="bs-member-email">{t("brainSettings.members.email")}</FieldLabel>
                <Input
                  id="bs-member-email"
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  value={email}
                  placeholder="name@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field className="sm:w-40">
                <FieldLabel htmlFor="bs-member-role">{t("brainSettings.members.role")}</FieldLabel>
                <Select items={roleItems} value={role} onValueChange={(v) => v && setRole(v as MemberRole)}>
                  <SelectTrigger id="bs-member-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleItems.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button type="submit" disabled={busy || !email.trim()}>
                <UserPlusIcon />
                {t("brainSettings.members.add")}
              </Button>
            </FieldGroup>
          </form>

          {members.isLoading ? (
            <LoadingRows rows={2} />
          ) : (
            <ul className="divide-y divide-line border-y border-line" aria-label={t("brainSettings.members.title")}>
              {(members.data ?? []).map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <Ltr mono className="min-w-0 flex-1 truncate text-grid-fg">
                    {m.userId}
                  </Ltr>
                  <Select
                    items={roleItems}
                    value={m.role}
                    disabled={busy}
                    onValueChange={(v) => v && v !== m.role && void run(() => profileApi.setMember({ namespace: ns, userId: m.userId, role: v as MemberRole }))}
                  >
                    <SelectTrigger className="w-32" aria-label={t("brainSettings.members.roleFor", { who: m.userId })}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleItems.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ConfirmButton
                    label={t("brainSettings.members.remove")}
                    title={t("brainSettings.members.removeTitle")}
                    description={t("brainSettings.members.removeBody", { who: m.userId })}
                    confirmLabel={t("brainSettings.members.remove")}
                    onConfirm={async () => {
                      await run(() => profileApi.removeMember({ namespace: ns, userId: m.userId }), t("brainSettings.members.removed"))
                    }}
                  />
                </li>
              ))}
              {(members.data ?? []).length === 0 ? <li className="py-3 text-sm text-grid-muted">{t("brainSettings.members.none")}</li> : null}
            </ul>
          )}
          <p className="text-xs text-grid-muted">
            <Badge variant="secondary" className="me-1.5 font-normal">
              {t("brainSettings.role.editor")}
            </Badge>
            {t("brainSettings.members.rolesHint")}
          </p>
        </div>
      )}
    </Section>
  )
}

// ── Danger zone ──────────────────────────────────────────────────────────────────────

function DangerSection({ ns, edit }: { ns: string; edit: EditLevel }) {
  const { t, locale, formatNumber } = useTranslations()
  const router = useRouter()
  const { mutate } = useSWRConfig()
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)

  async function destroy() {
    setBusy(true)
    try {
      const res = await brainApi.deleteBrain({ namespace: ns, confirm })
      void mutate(isBrainKey)
      toast.success(t("brains.delete.done", { brain: ns, count: formatNumber(res?.deleted ?? 0) }))
      router.replace(`/${locale}/brains`)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.networkError"))
      setBusy(false)
    }
  }

  return (
    <Section id="settings-danger" danger title={t("brainSettings.danger.title")} hint={t("brainSettings.danger.hint")}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border border-line p-4">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t("brainSettings.danger.export")}</h3>
            <p className="mt-0.5 text-xs text-grid-muted">{t("brainSettings.danger.exportHint")}</p>
          </div>
          <Button variant="outline" nativeButton={false} render={<a href={brainApi.exportUrl(ns)} download />}>
            <DownloadIcon />
            {t("brainSettings.danger.exportButton")}
          </Button>
        </div>

        {edit === "full" ? (
          <div className="grid gap-4 border border-grid-danger/40 p-4">
            <div>
              <h3 className="text-sm font-medium text-grid-danger-text">{t("brainSettings.danger.delete")}</h3>
              <p className="mt-0.5 text-xs text-grid-muted">{t("brainSettings.danger.deleteHint")}</p>
            </div>
            <Field>
              <FieldLabel htmlFor="bs-confirm">
                {t("brainSettings.danger.typeToConfirm")} <Ltr mono>{ns}</Ltr>
              </FieldLabel>
              <Input
                id="bs-confirm"
                dir="ltr"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={ns}
                className="max-w-sm"
              />
            </Field>
            <div>
              <Button variant="destructive" disabled={busy || confirm !== ns} onClick={() => void destroy()}>
                {busy ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                {t("brainSettings.danger.deleteButton")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  )
}
