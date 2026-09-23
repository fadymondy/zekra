import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { NoteMarkdown } from "@/components/notes/note-markdown";

import { frontmatterText, type FrontmatterValue } from "../../../shared/frontmatter";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { enhance } from "./enhance";
import { prepareMarkdown } from "./prepare";

/*
The web note renderer (NoteMarkdown: marked + highlight.js + DOMPurify, code
and table actions, reading settings) WRAPPED with Mark It Down's extras, which
the web renderer lacks. Opt-in: the desktop preview surfaces that want them
render <ExtendedMarkdown> instead of <NoteMarkdown>; ../web is not modified.

  source -> prepareMarkdown (frontmatter, math, mermaid, footnotes out)
         -> <NoteMarkdown text={prepared.body}>
         -> enhance() over the rendered DOM (KaTeX, Mermaid, alerts, footnotes)

NoteMarkdown writes its HTML with dangerouslySetInnerHTML after mount, so the
DOM pass is driven by a MutationObserver: whenever the body is re-rendered the
pass runs again (it is idempotent, so its own mutations settle immediately).
*/

export function ExtendedMarkdown({ text, showFrontmatter = true }: { text: string; showFrontmatter?: boolean }) {
  const { t } = useI18n();
  const { resolvedTheme } = useSession();
  const dark = resolvedTheme === "dark";
  const prepared = useMemo(() => prepareMarkdown(text ?? ""), [text]);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cleanup: (() => void) | null = null;
    let frame = 0;
    const run = () => {
      frame = 0;
      const body = host.firstElementChild;
      if (!body) return;
      cleanup?.();
      cleanup = enhance(body, {
        prepared,
        dark,
        t: (k) => t(k),
        onError: (m) => toast.error(m),
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      cleanup?.();
    };
  }, [prepared, dark, t]);

  return (
    <div className="min-w-0">
      {showFrontmatter && prepared.frontmatter && Object.keys(prepared.frontmatter).length > 0 ? (
        <FrontmatterPanel data={prepared.frontmatter} />
      ) : null}
      <div ref={hostRef}>
        <NoteMarkdown text={prepared.body} />
      </div>
    </div>
  );
}

/** The document's YAML frontmatter as a collapsible key/value table. */
export function FrontmatterPanel({ data }: { data: Record<string, FrontmatterValue> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const entries = Object.entries(data).filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0));
  if (!entries.length) return null;
  return (
    <section className="mb-5 rounded-md border border-border/60 bg-pane-raised text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-start font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={`size-3.5 transition-transform ${open ? "" : "-rotate-90 rtl:rotate-90"}`} />
        {t("mdx.properties")}
        <span className="ms-auto tabular-nums text-muted-foreground">{entries.length}</span>
      </button>
      {open ? (
        <dl className="grid grid-cols-[minmax(6rem,max-content)_1fr] gap-x-4 gap-y-1.5 border-t border-border/60 px-3 py-2.5">
          {entries.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-muted-foreground">{k}</dt>
              <dd dir="auto" className="min-w-0 break-words text-foreground">
                {Array.isArray(v) ? (
                  <span className="flex flex-wrap gap-1">
                    {v.map((item) => (
                      <span key={item} className="rounded-sm bg-muted px-1.5 py-0.5">
                        {item}
                      </span>
                    ))}
                  </span>
                ) : typeof v === "boolean" ? (
                  <code>{String(v)}</code>
                ) : (
                  frontmatterText(v)
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
