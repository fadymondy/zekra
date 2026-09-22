"use client"

import { useState, type FormEvent } from "react"
import useSWR from "swr"
import { GithubIcon, Loader2Icon, SaveIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { toastError } from "@/components/admin/toast-error"
import { Ltr } from "@/components/copy-field"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { noRetryOn4xx } from "@/lib/queries"

/*
GitHub note sync (MH-316), first slice.

One-way: this publishes a brain's notes to a repository. Nothing is read back,
so there is no "pull" here and no conflict UI — see the issue for why two-way
is a separate piece of work.

The token is write-only by design. It is sent here, stored encrypted in the
brain's secret store, and no endpoint returns it; the server answers only
`hasToken`. So the field shows a placeholder rather than a value, and leaving it
blank on save keeps the token that is already stored.
*/

type Config = {
  namespace: string
  owner: string
  repo: string
  branch: string
  pathTemplate: string
  enabled: boolean
  lastPushAt?: string
  lastCommit?: string
}

type Answer = { config: Config; hasToken: boolean }

type PushResult = { commit: string; files: number; branch: string; unchanged: boolean; url?: string }

export function GitHubSync({ namespace, canEdit }: { namespace: string; canEdit: boolean }) {
  const { t } = useTranslations()
  const key = `/api/brain/notes/github?namespace=${encodeURIComponent(namespace)}`
  const { data, error, isLoading, mutate } = useSWR<Answer>(key, () => api<Answer>(key), noRetryOn4xx)

  const [owner, setOwner] = useState<string | null>(null)
  const [repo, setRepo] = useState<string | null>(null)
  const [branch, setBranch] = useState<string | null>(null)
  const [pathTemplate, setPathTemplate] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [token, setToken] = useState("")
  const [saving, setSaving] = useState(false)
  const [pushing, setPushing] = useState(false)

  if (isLoading) return <p className="text-sm text-grid-muted">{t("common.loading")}</p>
  // A 403 here means "not an admin of this brain", which is a normal state for
  // an editor rather than an error worth a red panel.
  if (error) return <p className="text-sm text-grid-muted">{t("github.noAccess")}</p>

  const cfg = data?.config
  // Uncontrolled until touched, so a value arriving from the server does not
  // overwrite what is being typed.
  const value = {
    owner: owner ?? cfg?.owner ?? "",
    repo: repo ?? cfg?.repo ?? "",
    branch: branch ?? cfg?.branch ?? "main",
    pathTemplate: pathTemplate ?? cfg?.pathTemplate ?? "notes/{slug}.md",
    enabled: enabled ?? cfg?.enabled ?? false,
  }
  const configured = !!cfg?.owner && !!cfg?.repo

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const next = await api<Answer>("/api/brain/notes/github", {
        method: "PUT",
        // An empty token means "keep the stored one" — the server only writes
        // the secret when this is non-empty.
        json: { namespace, ...value, ...(token ? { token } : {}) },
      })
      setToken("")
      await mutate(next, { revalidate: false })
      toast.success(t("github.saved"))
    } catch (err) {
      toastError(err, t("github.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  async function push() {
    setPushing(true)
    try {
      const result = await api<PushResult>("/api/brain/notes/github/push", { json: { namespace } })
      if (result.unchanged) toast.success(t("github.pushedUnchanged"))
      else toast.success(t("github.pushed", { files: String(result.files) }))
      await mutate()
    } catch (err) {
      toastError(err, t("github.pushFailed"))
    } finally {
      setPushing(false)
    }
  }

  return (
    <form onSubmit={save}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="gh-owner">{t("github.owner")}</FieldLabel>
            <Input
              id="gh-owner"
              dir="ltr"
              value={value.owner}
              onChange={(e) => setOwner(e.target.value)}
              disabled={!canEdit}
              placeholder="fadymondy"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="gh-repo">{t("github.repo")}</FieldLabel>
            <Input
              id="gh-repo"
              dir="ltr"
              value={value.repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={!canEdit}
              placeholder="notes"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="gh-branch">{t("github.branch")}</FieldLabel>
            <Input id="gh-branch" dir="ltr" value={value.branch} onChange={(e) => setBranch(e.target.value)} disabled={!canEdit} />
          </Field>
          <Field>
            <FieldLabel htmlFor="gh-path">{t("github.path")}</FieldLabel>
            <Input
              id="gh-path"
              dir="ltr"
              value={value.pathTemplate}
              onChange={(e) => setPathTemplate(e.target.value)}
              disabled={!canEdit}
            />
            <FieldDescription>{t("github.pathHint")}</FieldDescription>
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="gh-token">{t("github.token")}</FieldLabel>
          <Input
            id="gh-token"
            dir="ltr"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={!canEdit}
            placeholder={data?.hasToken ? t("github.tokenStored") : "ghp_…"}
          />
          <FieldDescription>{data?.hasToken ? t("github.tokenReplace") : t("github.tokenHint")}</FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <Switch id="gh-enabled" checked={value.enabled} onCheckedChange={(v) => setEnabled(v)} disabled={!canEdit} />
          <FieldLabel htmlFor="gh-enabled">{t("github.enabled")}</FieldLabel>
        </Field>

        {cfg?.lastPushAt ? (
          <p className="text-sm text-grid-muted">
            {t("github.lastPush", { when: new Date(cfg.lastPushAt).toLocaleString() })}{" "}
            <Ltr className="font-mono text-xs">{cfg.lastCommit?.slice(0, 7)}</Ltr>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canEdit || saving}>
            {saving ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            {t("common.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            // Pushing an unsaved form would publish the STORED config, not what
            // is on screen — so it is gated on a saved, enabled, tokened setup.
            disabled={!canEdit || pushing || !configured || !cfg?.enabled || !data?.hasToken}
            onClick={() => void push()}
          >
            {pushing ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
            {t("github.push")}
          </Button>
          {configured ? (
            <Button
              variant="ghost"
              nativeButton={false}
              render={
                <a href={`https://github.com/${cfg!.owner}/${cfg!.repo}`} target="_blank" rel="noreferrer noopener" />
              }
            >
              <GithubIcon />
              {t("github.open")}
            </Button>
          ) : null}
        </div>
      </FieldGroup>
    </form>
  )
}
