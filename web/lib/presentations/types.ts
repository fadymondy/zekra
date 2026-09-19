/*
Presentations: the content model, mirrored from the Go validator (schema.go in
the brain plugin's presentations package). The Go validator is the authority; these
types describe what it lets through (scene params arrive with defaults filled).
*/

export type Kind = "deck" | "report" | "page"
export type PLocale = "en" | "ar"
export type Status = "draft" | "ready" | "archived"
export type StyleKey = "minimal" | "bold" | "editorial" | "tech-dark"

export const KINDS: Kind[] = ["deck", "report", "page"]
export const STATUSES: Status[] = ["draft", "ready", "archived"]
export const STYLE_KEYS: StyleKey[] = ["minimal", "bold", "editorial", "tech-dark"]

export type ColorToken =
  | "brand"
  | "primary"
  | "accent"
  | "foreground"
  | "muted"
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"

export type Scene = { type: string; params: Record<string, unknown> }

// ---- FM-350 blocks (deck slide, report block, page section) ----
export type Tone = "neutral" | "info" | "success" | "warning" | "danger"
export type Trend = "up" | "down" | "flat"
export type StepKind = "step" | "decision" | "human_review" | "system" | "output"
export type WorkflowStep = { id: string; title: string; text?: string; icon?: string; owner?: string; kind?: StepKind }
export type WorkflowBlock = {
  type: "workflow"
  title?: string
  body?: string
  layout?: "horizontal" | "vertical" | "auto"
  steps: WorkflowStep[]
  edges?: { from: string; to: string; label?: string }[]
  highlight?: string
  caption?: string
}
export type ListItem = { title: string; meta?: string; status?: string; tone?: Tone; icon?: string }
export type MapMarker = {
  id: string
  x: number
  y: number
  kind: "driver" | "vendor" | "customer" | "hub"
  label?: string
  status?: string
  tone?: Tone
}
export type MapPart = {
  type: "map"
  title?: string
  height?: "sm" | "md" | "lg"
  markers: MapMarker[]
  routes?: { from: string; to: string; via?: { x: number; y: number }[]; tone?: Tone; dashed?: boolean; label?: string }[]
  suggest?: { vendor: string; driver: string; eta?: string; distance?: string }
  zones?: { x: number; y: number; r: number; label?: string; tone?: Tone }[]
  legend?: boolean
}
export type ScreenPart =
  | MapPart
  | { type: "kpis"; items: { label: string; value: string; delta?: string; trend?: Trend; icon?: string }[] }
  | { type: "table"; title?: string; columns: string[]; rows: { cells: string[]; status?: string; tone?: Tone }[] }
  | {
      type: "form"
      title?: string
      fields: { label: string; value?: string; type?: "text" | "select" | "date" | "number" | "file"; state?: "ok" | "missing" | "warning"; hint?: string }[]
      submit_label?: string
    }
  | { type: "chart"; title?: string; chart: "bar" | "line" | "donut"; labels: string[]; series: { name: string; values: number[] }[] }
  | { type: "list" | "timeline"; title?: string; items: ListItem[] }
  | { type: "board"; title?: string; columns: { title: string; cards?: { title: string; meta?: string; tone?: Tone; icon?: string }[] }[] }
  | { type: "split"; left_label?: string; right_label?: string; left: ScreenPart[]; right: ScreenPart[] }
  | { type: "callout"; tone: "info" | "success" | "warning" | "danger"; title?: string; text: string }
  | { type: "image"; url: string; alt: string; caption?: string }
export type ScreenBlock = {
  type: "screen"
  title?: string
  frame: "browser" | "app" | "tablet" | "desktop"
  screen_title?: string
  url?: string
  layout?: "sidebar" | "topbar" | "none"
  nav?: { label: string; icon?: string; active?: boolean }[]
  parts: ScreenPart[]
  annotations?: { target_part_index: number; text: string }[]
  /** A part index to enlarge; the others dim. */
  focus?: number
  caption?: string
}

// ---- deck ----
export type Column = { heading?: string; icon?: string; body?: string; bullets?: string[] }
export type Metric = { label: string; value: string; delta?: string; trend?: Trend; icon?: string }
export type Bullet = string | { text: string; icon?: string }
type SlideBase = { notes?: string; build?: boolean }
export type Slide = SlideBase &
  (
  | { type: "title"; title: string; subtitle?: string; eyebrow?: string; icon?: string }
  | { type: "bullets"; title: string; bullets: Bullet[] }
  | { type: "image"; title?: string; image_url: string; alt: string; caption?: string }
  | { type: "quote"; quote: string; author?: string; role?: string }
  | { type: "metric"; title?: string; metrics: Metric[] }
  | { type: "two_column"; title?: string; left: Column; right: Column }
  | { type: "code"; title?: string; language?: string; code: string }
  | { type: "embed"; title?: string; document_id: string }
  | WorkflowBlock
  | ScreenBlock
  )
export type DeckContent = { title: string; subtitle?: string; transition?: "fade" | "slide" | "none"; slides: Slide[] }

export const bulletText = (b: Bullet) => (typeof b === "string" ? b : b.text)
export const bulletIcon = (b: Bullet) => (typeof b === "string" ? undefined : b.icon)

// ---- report ----
export type ChartBlock = {
  type: "chart"
  chart: "bar" | "line" | "area" | "stacked_bar"
  title?: string
  unit?: string
  labels: string[]
  series: { name: string; values: number[] }[]
  caption?: string
}
export type Block =
  | { type: "markdown"; text: string }
  | { type: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { type: "callout"; tone: "info" | "success" | "warning" | "danger"; title?: string; text: string }
  | ChartBlock
  | WorkflowBlock
  | ScreenBlock
export type ReportContent = {
  title: string
  subtitle?: string
  summary?: string
  sections: { heading: string; blocks: Block[] }[]
}

// ---- page ----
export type PageSection =
  | {
      type: "hero"
      eyebrow?: string
      heading: string
      body?: string
      cta_label?: string
      cta_href?: string
      scene?: Scene
      /** A screen or workflow beside the text. */
      visual?: WorkflowBlock | ScreenBlock
    }
  | { type: "features"; heading?: string; body?: string; items: { title: string; body?: string; icon?: string }[] }
  | {
      type: "pricing"
      heading?: string
      body?: string
      plans: {
        name: string
        price: string
        period?: string
        description?: string
        features?: string[]
        highlighted?: boolean
        cta_label?: string
      }[]
    }
  | { type: "testimonial"; quote: string; author: string; role?: string }
  | { type: "cta"; heading: string; body?: string; cta_label?: string; cta_href?: string }
  | { type: "gallery"; heading?: string; images: { url: string; alt: string; caption?: string }[] }
  | { type: "scene"; heading?: string; body?: string; scene: Scene; height?: "sm" | "md" | "lg" }
  | WorkflowBlock
  | ScreenBlock
export type PageContent = { title: string; description?: string; sections: PageSection[] }

export type Content = DeckContent | ReportContent | PageContent

export type Customer = { name: string; company: string; email?: string }

export type Share = {
  id: string
  presentation_id: string
  label: string
  locale: PLocale
  hint: string
  url: string
  expires_at: string | null
  revoked_at: string | null
  active: boolean
  view_count: number
  download_count: number
  last_viewed_at: string | null
  created_at: string
}

export type Summary = {
  /** The brain this document belongs to. */
  namespace: string
  id: string
  kind: Kind
  title: string
  customer: Customer
  locale: PLocale
  locales: PLocale[] | null
  status: Status
  style: string
  view_count: number
  download_count: number
  last_viewed_at: string | null
  active_shares: number
  updated_at: string
}

export type Detail = Summary & {
  content: Partial<Record<PLocale, Record<string, unknown>>>
  translations: Record<string, unknown>
  created_at: string
  shares: Share[]
  formats: string[] | null
}

export type PublicEmbed = { style: string; content: PageContent }

export type PublicPresentation = {
  kind: Kind
  title: string
  customer: string
  company: string
  locale: PLocale
  locales: PLocale[] | null
  style: string
  content: Record<string, unknown>
  embeds: Record<string, PublicEmbed>
  formats: string[] | null
  expires_at: string | null
  updated_at: string
}

export type SceneParam = {
  name: string
  kind: string
  description: string
  min?: number
  max?: number
  enum?: string[]
  min_items?: number
  max_items?: number
  default: unknown
}
export type SceneType = { type: string; engine: "three" | "canvas" | "iframe"; description: string; params: SceneParam[] }
export type Catalog = {
  styles: { key: StyleKey; name: string; description: string }[]
  scenes: SceneType[]
  colors: string[]
  icons: string[]
  blocks: string
  schemas: Record<string, unknown>
}

export type FieldError = { path: string; message: string }

/** Where POST /api/presentations/from-brain drafts a document from. */
export type FromBrainSource =
  | { type: "notes"; note_ids: string[] }
  | { type: "search"; query: string }
  | { type: "entity"; entity: string }
  | { type: "brain" }
