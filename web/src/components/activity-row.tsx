import type { ActivityItem } from "../lib/brain";
import { Monogram, ToneTag, toneFor } from "./page";

/** One memory operation in a feed: who, what, where, how long, the outcome and when. Shared by
 *  the Activity, Sessions and Users screens so every feed reads the same. */
export function ActivityRow({
  a,
  showNamespace = false,
  showAgent = true,
}: {
  a: ActivityItem;
  showNamespace?: boolean;
  showAgent?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      {showAgent && <Monogram id={a.agentId || "?"} />}
      <span className="num font-medium text-foreground">{a.op}</span>
      {showNamespace && <span dir="ltr" className="num text-xs text-muted-foreground">{a.namespace || "—"}</span>}
      {showAgent && <span dir="ltr" className="min-w-0 truncate text-xs text-muted-foreground">{a.agentId || "—"}</span>}
      <span className="num ms-auto text-[11px] text-muted-foreground">{a.latencyMs ? `${a.latencyMs}ms` : ""}</span>
      <ToneTag tone={toneFor(a.outcome)}>{a.outcome}</ToneTag>
      <span className="num min-w-[5.5rem] text-end text-[11px] text-muted-foreground">
        {a.ts ? new Date(a.ts).toLocaleTimeString() : ""}
      </span>
    </div>
  );
}
