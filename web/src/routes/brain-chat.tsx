import { useMemo, useRef, useState, useEffect } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Send, FileText, Clock, Cpu, Layers, AlertTriangle, Route } from "lucide-react";
import { Button, Textarea } from "@togo-framework/ui";
import { brainApi, type ChatTurn, type ChatAnswer, type Recalled } from "../lib/brain";
import { MemorySquare } from "../components/brand";
import { RecallSquares } from "../components/page";

/** "The brain is thinking" — the brand's recall squares lighting one after another while an
 * answer is recalled and generated. Colour-only motion (cb-recall keyframes in app.css). */
function ThinkingPulse() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <RecallSquares />
      <span>recalling memories &amp; thinking…</span>
    </div>
  );
}

// A rendered turn: user text, or an assistant answer with its provenance.
type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; answer?: ChatAnswer; loading?: boolean; error?: string };

/** Inline [n] citations → mono footnote chips that scroll to the matching source below. */
function renderWithCitations(text: string, onCite: (n: number) => void) {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (m) {
      const n = Number(m[1]);
      return (
        <button
          key={i}
          onClick={() => onCite(n)}
          className="num mx-0.5 inline-flex h-5 min-w-5 items-center justify-center border border-border bg-muted px-1 align-baseline text-[11px] font-medium text-active hover:border-active"
          title={`Source ${n}`}
        >
          {n}
        </button>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

/** Provenance footer for an assistant answer: footprint + expandable citations. Tolerant of a
 * missing/partial footprint so extra/absent fields never hard-break the render. */
function Provenance({ answer, focusCite }: { answer: ChatAnswer; focusCite: number | null }) {
  const fp = answer.footprint ?? ({} as ChatAnswer["footprint"]);
  const citations = answer.citations ?? [];
  return (
    <div className="mt-3 space-y-2">
      {/* Footprint — the auditable trace */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="micro inline-flex items-center gap-1.5 text-muted-foreground"><Route className="h-3 w-3" /> traced from</span>
        <span className="grid-chip"><Layers className="h-3 w-3" /> {fp.recalled ?? citations.length} memories</span>
        {fp.model && <span className="grid-chip num"><Cpu className="h-3 w-3" /> {fp.model}</span>}
        {typeof fp.latencyMs === "number" && (
          <span className="grid-chip num"><Clock className="h-3 w-3" /> {(fp.latencyMs / 1000).toFixed(1)}s</span>
        )}
        {fp.grounded === false && (
          <span className="grid-chip text-tone-warn"><AlertTriangle className="h-3 w-3" /> no matching memory</span>
        )}
      </div>
      {/* Citations */}
      {citations.length > 0 && (
        <details open className="border border-border">
          <summary className="micro cursor-pointer px-3 py-2 text-muted-foreground">
            {citations.length} source{citations.length === 1 ? "" : "s"} cited
          </summary>
          <ol className="divide-y divide-border border-t border-border">
            {citations.map((c: Recalled, i) => (
              <li
                key={c.id}
                id={`cite-${i + 1}`}
                className={`p-3 text-xs transition-colors ${focusCite === i + 1 ? "border-s-2 border-s-active bg-muted" : ""}`}
              >
                <div className="mb-1.5 flex items-center gap-2 text-muted-foreground">
                  <span className="num inline-flex h-4 min-w-4 items-center justify-center bg-muted px-1 text-[10.5px] text-active">{i + 1}</span>
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="num">{c.network}·{c.memoryType}</span>
                  {c.sourceKind && <span className="num truncate">· {c.sourceKind}{c.sourceRef ? `/${c.sourceRef}` : ""}</span>}
                  <span className="num ms-auto shrink-0">score {c.score.toFixed(3)}</span>
                </div>
                <div className="text-card-foreground">{c.content}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function BrainChat() {
  const { namespace } = useParams({ strict: false }) as { namespace: string };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusCite, setFocusCite] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Suggestions from the brain's graph — a few named entities so the blank canvas is never empty.
  const graph = useQuery({ queryKey: ["brain", "graph", namespace], queryFn: () => brainApi.graph(namespace, 3000) });
  const suggestions = useMemo(() => {
    const nodes = (graph.data?.nodes ?? []).filter((n) => !["root", "type"].includes(n.group ?? ""));
    const names = Array.from(new Set(nodes.map((n) => n.name).filter(Boolean)));
    return names.slice(0, 4).map((n) => `Tell me about ${n}`);
  }, [graph.data]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  // Reset the conversation when the brain changes.
  useEffect(() => { setMsgs([]); setInput(""); }, [namespace]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", loading: true }]);
    try {
      const r = await brainApi.chat({ namespace, message: q, history });
      setMsgs((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          if (r.error) next[next.length - 1] = { role: "assistant", content: "", error: `${r.error.code}: ${r.error.message}` };
          else next[next.length - 1] = { role: "assistant", content: r.answer, answer: r };
        }
        return next;
      });
    } catch (e: any) {
      setMsgs((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: "", error: String(e?.message ?? e) };
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable transcript */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
          {msgs.length === 0 ? (
            // Initial invitation, seeded with the brain's own entities.
            <section className="border border-border bg-card p-6 sm:p-8">
              <div className="flex items-center gap-2.5">
                <MemorySquare />
                <span className="micro text-muted-foreground">Chat</span>
              </div>
              <h2 className="mt-3 text-2xl font-medium tracking-tight text-foreground">
                Ask the <span dir="ltr" className="text-active">{namespace}</span> brain
              </h2>
              <p className="mt-2 max-w-[60ch] text-sm font-light leading-relaxed text-card-foreground">
                A live agent grounded only in this brain's memories — every answer cites the memories it used.
              </p>
              {suggestions.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => send(s)} className="grid-chip transition-colors hover:border-active hover:text-foreground">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : (
            msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap bg-primary px-4 py-2.5 text-sm text-primary-foreground">{m.content}</div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="w-full max-w-[90%] border border-border bg-card px-4 py-3">
                    <div className="mb-2 flex items-center gap-2">
                      <MemorySquare />
                      <span dir="ltr" className="micro text-muted-foreground">{namespace}</span>
                    </div>
                    {m.loading ? (
                      <ThinkingPulse />
                    ) : m.error ? (
                      <div className="text-sm text-tone-danger">{m.error}</div>
                    ) : (
                      <>
                        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          {renderWithCitations(m.content, (n) => {
                            setFocusCite(n);
                            document.getElementById(`cite-${n}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                          })}
                        </div>
                        {m.answer && <Provenance answer={m.answer} focusCite={focusCite} />}
                      </>
                    )}
                  </div>
                </div>
              )
            )
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            rows={1}
            placeholder={`Ask the ${namespace} brain…`}
            className="max-h-40 min-h-[44px] flex-1 resize-none"
          />
          <Button onClick={() => send(input)} disabled={busy || !input.trim()} className="h-11">
            <Send className="h-4 w-4" /> Ask
          </Button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted-foreground">
          Answers are grounded only in this brain's memories and cite their sources.
        </p>
      </div>
    </div>
  );
}
