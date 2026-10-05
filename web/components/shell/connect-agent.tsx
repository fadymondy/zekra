"use client"

// "Connect your agent" in the app header: Nasaq's McpConnectSheet side-over, with the MCP app picker
// (McpConnectApps) and the REST API as connection types. The MCP endpoint comes from
// NEXT_PUBLIC_MCP_URL, else this origin's /api/mcp. Admins can mint a key right in the sheet for the
// apps that need one (Cursor, VS Code, another app); everyone else signs in with OAuth.
import { useEffect, useState, type FormEvent } from "react"
import { BracesIcon } from "lucide-react"
import { Button, CopyField, Field, FieldLabel, Input, McpConnectApps, McpConnectSheet, McpLogo } from "@fadymondy/nasaq/web"

import { ApiError, brainApi } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { brandName } from "@/lib/brand-name"
import { isAdmin, useMe } from "@/lib/queries"

function useOrigin(): string {
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])
  return origin
}

/** Mints an access token for an MCP client that cannot sign in with OAuth. Admin only. */
function MintKeyForm({ onMinted }: { onMinted: (token: string) => void }) {
  const { t } = useTranslations()
  const me = useMe()
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isAdmin(me.data)) return <p className="text-sm text-muted-foreground">{t("connectAgent.askAdmin")}</p>

  async function submit(e: FormEvent) {
    e.preventDefault()
    const name = label.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const agentId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent"
      const tok = await brainApi.createToken({ agentId, label: name, isAdmin: false })
      onMinted(tok.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.networkError"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <Field>
        <FieldLabel htmlFor="connect-key-label">{t("connectAgent.keyLabel")}</FieldLabel>
        <Input id="connect-key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("connectAgent.keyPlaceholder")} />
      </Field>
      {error ? <p className="text-sm text-nq-danger">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={busy || !label.trim()}>
        {t("connectAgent.createKey")}
      </Button>
    </form>
  )
}

export function ConnectAgent() {
  const { t, locale } = useTranslations()
  const origin = useOrigin()
  if (!origin) return null
  const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL || `${origin}/api/mcp`
  const product = brandName(locale)

  return (
    <McpConnectSheet
      types={[
        {
          value: "mcp",
          label: "MCP",
          description: t("connectAgent.mcpHint"),
          icon: <McpLogo />,
          content: (
            <McpConnectApps
              product={product}
              server={{ name: "zekra", url: mcpUrl }}
              oauth
              renderKeyForm={(done) => <MintKeyForm onMinted={done} />}
              tryHint={t("connectAgent.tryHint")}
            />
          ),
        },
        {
          value: "api",
          label: "API",
          description: t("connectAgent.apiHint"),
          icon: <BracesIcon />,
          content: (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">{t("connectAgent.apiBody")}</p>
              <CopyField value={`${origin}/api/brain`} label={t("connectAgent.apiUrl")} />
            </div>
          ),
        },
      ]}
    />
  )
}
