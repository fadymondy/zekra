import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Rocket, Copy, Check } from "lucide-react";
import {
  Button, Switch, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@togo-framework/ui";
import { brainApi, type SessionResult } from "../lib/brain";

/** Launch-session dialog — mints a scoped token + Claude Code MCP config for this brain
 * (read-only or read+write) and shows the ready-to-paste .mcp.json snippet. The raw token is
 * shown once; copy it now. Shared by the Brains hub cards and the brain workspace Sessions
 * tab. Built on the kit Dialog, which the grid bridge draws as its one rounded floating
 * surface. */
export function LaunchSessionModal({ namespace, onClose }: { namespace: string; onClose: () => void }) {
  const [write, setWrite] = useState(false);
  const [copied, setCopied] = useState(false);
  const [res, setRes] = useState<SessionResult | null>(null);
  const launch = useMutation({
    mutationFn: () => brainApi.launchSession({ namespace, write, label: `console session for ${namespace}` }),
    onSuccess: (r) => { if (!r.error) setRes(r); },
  });
  const snippet = res ? JSON.stringify(res.mcpConfig, null, 2) : "";
  const copy = () => {
    navigator.clipboard?.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="h-4 w-4 text-active" /> Launch session</DialogTitle>
          <DialogDescription>
            Start a Claude Code session bound to <code dir="ltr" className="font-mono text-foreground">{namespace}</code>.
          </DialogDescription>
        </DialogHeader>

        {!res ? (
          <>
            <div className="flex items-center justify-between gap-3 border border-border px-3 py-2.5">
              <Label htmlFor="launch-write" className="text-sm font-normal text-foreground">
                Allow writes <span className="text-muted-foreground">(retain into this brain)</span>
              </Label>
              <Switch id="launch-write" checked={write} onCheckedChange={setWrite} />
            </div>
            {launch.data?.error && (
              <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-tone-danger">
                {launch.data.error.code}: {launch.data.error.message}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => launch.mutate()} disabled={launch.isPending}>
                <Rocket className="h-4 w-4" /> {launch.isPending ? "Minting…" : "Mint session token"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span dir="ltr" className="grid-chip">{res.namespace}</span>
              <span className={`grid-chip ${res.write ? "text-tone-ok" : ""}`}>{res.write ? "read + write" : "read-only"}</span>
              <span className="num text-[11px] text-muted-foreground">agent {res.agentId}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste into <code className="font-mono">.mcp.json</code>, then start Claude Code. The token is shown once — copy it now.
            </p>
            <div className="relative">
              <pre dir="ltr" className="max-h-56 overflow-auto border border-border bg-background p-3 font-mono text-xs text-foreground"><code>{snippet}</code></pre>
              <Button variant="outline" size="sm" onClick={copy} className="absolute end-2 top-2 h-7 gap-1 px-2 text-xs">
                {copied ? <><Check className="h-3.5 w-3.5 text-tone-ok" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{res.howto}</p>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
