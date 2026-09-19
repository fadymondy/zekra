import { CircleDotIcon, DatabaseIcon, FileTextIcon, GithubIcon, GlobeIcon, NotebookTextIcon, PlugIcon, WebhookIcon, type LucideIcon } from "lucide-react"

// The connector kinds the add-source dialog offers (docs/datasources.md). Each field maps 1:1
// onto the created source's `config` key. Labels/placeholders are dictionary keys, except
// placeholders that are literal data (URLs, SQL), which stay untranslated.
export type KindField = {
  key: string
  label: string
  placeholder: string
  textarea?: boolean
  optional?: boolean
  secret?: boolean
  number?: boolean
}
export type KindSpec = { kind: string; icon: LucideIcon; fields: KindField[]; soon?: boolean }

export const KINDS: KindSpec[] = [
  { kind: "webhook", icon: WebhookIcon, fields: [] },
  {
    kind: "text",
    icon: FileTextIcon,
    fields: [
      { key: "title", label: "sources.field.title", placeholder: "", optional: true },
      { key: "content", label: "sources.field.content", placeholder: "sources.ph.text", textarea: true },
    ],
  },
  {
    kind: "markdown",
    icon: NotebookTextIcon,
    fields: [
      { key: "title", label: "sources.field.title", placeholder: "", optional: true },
      { key: "content", label: "sources.field.content", placeholder: "# Notes\n…", textarea: true },
    ],
  },
  {
    kind: "crawler",
    icon: GlobeIcon,
    fields: [
      { key: "url", label: "sources.field.url", placeholder: "https://docs.example.com" },
      { key: "maxPages", label: "sources.field.maxPages", placeholder: "50", optional: true, number: true },
    ],
  },
  {
    kind: "github",
    icon: GithubIcon,
    fields: [
      { key: "repo", label: "sources.field.repo", placeholder: "owner/name" },
      { key: "branch", label: "sources.field.branch", placeholder: "main", optional: true },
      { key: "path", label: "sources.field.path", placeholder: "docs/", optional: true },
      { key: "ext", label: "sources.field.ext", placeholder: ".md", optional: true },
      { key: "token", label: "sources.field.token", placeholder: "ghp_…", optional: true, secret: true },
    ],
  },
  {
    kind: "sql",
    icon: DatabaseIcon,
    fields: [
      { key: "driver", label: "sources.field.driver", placeholder: "pgx", optional: true },
      { key: "dsn", label: "sources.field.dsn", placeholder: "postgres://user:pass@host/db", secret: true },
      { key: "query", label: "sources.field.query", placeholder: "SELECT id, title, body FROM articles", textarea: true },
      { key: "refColumn", label: "sources.field.refColumn", placeholder: "id", optional: true },
      { key: "titleColumn", label: "sources.field.titleColumn", placeholder: "title", optional: true },
    ],
  },
  { kind: "pdf", icon: FileTextIcon, fields: [], soon: true },
  { kind: "image", icon: CircleDotIcon, fields: [], soon: true },
  { kind: "mcp", icon: PlugIcon, fields: [], soon: true },
]

export const KIND_BY: Record<string, KindSpec> = Object.fromEntries(KINDS.map((k) => [k.kind, k]))

export function iconFor(kind: string): LucideIcon {
  return KIND_BY[kind]?.icon ?? PlugIcon
}
