"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { RotateCcwIcon, SendIcon } from "lucide-react"
import useSWR from "swr"

import { MarkdownAnswer } from "@/components/chat/markdown-answer"
import { Provenance } from "@/components/chat/provenance"
import { SectionHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, brainApi, type ChatAnswer, type ChatTurn } from "@/lib/api"
import { useTranslations } from "@/lib/i18n"
import { noRetryOn4xx } from "@/lib/queries"
import { useDocumentTitle } from "@/lib/title"

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; answer?: ChatAnswer; loading?: boolean; error?: string }

const storeKey = (ns: string) => `zekra.chat.${ns}`

function loadHistory(ns: string): Msg[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.sessionStorage.getItem(storeKey(ns))
    const list = raw ? (JSON.parse(raw) as Msg[]) : []
    return list.filter((m) => !(m.role === "assistant" && m.loading))
  } catch {
    return []
  }
}

/** Three squares lighting in turn while the brain recalls and answers. */
function Thinking({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-grid-muted" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-2 animate-pulse bg-grid-action" style={{ animationDelay: `${i * 200}ms` }} />
        ))}
      </span>
      <span>{label}</span>
    </div>
  )
}

export default function BrainChatPage() {
  const { t } = useTranslations()
  const params = useParams<{ namespace: string }>()
  const namespace = decodeURIComponent(params.namespace)
  useDocumentTitle(`${t("chat.title")} · ${namespace}`)

  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<{ msg: number; n: number } | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Restore this brain's conversation (per tab), and reset when the brain changes.
  const skipSave = useRef(false)
  useEffect(() => {
    skipSave.current = true
    setMsgs(loadHistory(namespace))
    setInput("")
  }, [namespace])
  useEffect(() => {
    // Skip the commit that still holds the previous brain's messages.
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    try {
      window.sessionStorage.setItem(storeKey(namespace), JSON.stringify(msgs.filter((m) => !(m.role === "assistant" && m.loading))))
    } catch {
      /* storage full or disabled */
    }
  }, [msgs, namespace])
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [msgs])

  // Suggestions from the brain's graph: a few named entities so the blank page is never empty.
  const graph = useSWR(["/api/brain/graph", namespace], ([, ns]: [string, string]) => brainApi.graph(ns, 3000), noRetryOn4xx)
  const suggestions = useMemo(() => {
    const nodes = (graph.data?.nodes ?? []).filter((n) => !["root", "type"].includes(n.group ?? ""))
    return Array.from(new Set(nodes.map((n) => n.name).filter(Boolean))).slice(0, 4)
  }, [graph.data])

  async function send(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setInput("")
    setBusy(true)
    const history: ChatTurn[] = msgs.filter((m) => !(m.role === "assistant" && (m.error || m.loading))).map((m) => ({ role: m.role, content: m.content }))
    setMsgs((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", loading: true }])
    let last: Msg
    try {
      const r = await brainApi.chat({ namespace, message: q, history })
      last = { role: "assistant", content: r.answer ?? "", answer: r }
    } catch (err) {
      last = {
        role: "assistant",
        content: "",
        error: err instanceof ApiError ? (err.status >= 500 ? t("common.apiUnavailable") : err.message) : t("common.networkError"),
      }
    }
    setMsgs((prev) => [...prev.slice(0, -1), last])
    setBusy(false)
  }

  // A suggestion chip from the overview opens chat?q=<question>: ask it once, then drop q so a
  // reload doesn't ask again. Read from window (not useSearchParams) to avoid a Suspense boundary.
  const askedFromUrl = useRef(false)
  useEffect(() => {
    if (askedFromUrl.current) return
    const url = new URL(window.location.href)
    const q = url.searchParams.get("q")
    if (!q) return
    askedFromUrl.current = true
    url.searchParams.delete("q")
    window.history.replaceState(null, "", url.pathname + url.search)
    void send(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, [])

  function cite(msg: number, n: number) {
    setFocus({ msg, n })
    document.getElementById(`m${msg}-cite-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  return (
    <div className="flex min-h-[calc(100svh-3.5rem)] flex-col">
      <SectionHeader
        micro={t("chat.micro")}
        title={
          <>
            {t("chat.askThe")} <span dir="ltr" className="text-grid-action">{namespace}</span>
          </>
        }
        description={t("chat.description")}
        action={
          msgs.length > 0 ? (
            <Button variant="outline" onClick={() => setMsgs([])} disabled={busy}>
              <RotateCcwIcon className="rtl:-scale-x-100" /> {t("chat.newChat")}
            </Button>
          ) : null
        }
      />

      <div className="flex-1 border-t border-line">
        {msgs.length === 0 ? (
          <section className="border-b border-line bg-grid-card px-6 py-8">
            <p className="grid-micro">{t("chat.suggestions")}</p>
            {suggestions.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => send(t("chat.tellMeAbout", { name: s }))}>
                    <span dir="auto">{t("chat.tellMeAbout", { name: s })}</span>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-grid-muted">{t("chat.emptyHint")}</p>
            )}
          </section>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 px-6 py-6" aria-live="polite">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div dir="auto" className="max-w-[85%] whitespace-pre-wrap bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="w-full max-w-[90%] border border-line bg-grid-card px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span aria-hidden className="size-2 bg-grid-action" />
                      <span dir="ltr" className="grid-micro">
                        {namespace}
                      </span>
                    </div>
                    {m.loading ? (
                      <Thinking label={t("chat.thinking")} />
                    ) : m.error ? (
                      <p role="alert" className="text-sm text-grid-danger">
                        {m.error}
                      </p>
                    ) : (
                      <>
                        <MarkdownAnswer text={m.content} onCite={(n) => cite(i, n)} />
                        {m.answer ? <Provenance answer={m.answer} idPrefix={`m${i}`} focusCite={focus?.msg === i ? focus.n : null} /> : null}
                      </>
                    )}
                  </div>
                </div>
              ),
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <form
        className="sticky bottom-0 border-t border-line bg-background px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            dir="auto"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void send(input)
              }
            }}
            rows={1}
            aria-label={t("chat.placeholder", { ns: namespace })}
            placeholder={t("chat.placeholder", { ns: namespace })}
            className="max-h-40 min-h-11 flex-1 resize-none"
          />
          <Button type="submit" disabled={busy || !input.trim()} className="h-11">
            <SendIcon className="rtl:-scale-x-100" /> {t("chat.ask")}
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-grid-muted">{t("chat.footnote")}</p>
      </form>
    </div>
  )
}
