import { AlertTriangle, Download, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

import type { UpdateState } from "../../../shared/ipc";
import { clampPercent, etaSeconds, formatSpeed, formatTransfer } from "../../../shared/update-format";
import { Markdown } from "../../components/markdown";
import { ZekraMark } from "../../components/zekra-mark";
import { bridge } from "../../lib/bridge";
import { useI18n, type TFn } from "../../lib/i18n";
import { canCheck, installNow, snooze } from "./use-update";

/*
The Software Update sheet: what is on offer, the download (bar, size, speed,
time left), the release notes (GitHub's release body — HTML or markdown —
through the app's markdown pipeline, sanitised) and the one action that fits:
Restart to Update / Later, or Check for Updates.
*/
export function UpdateSheet({ open, onOpenChange, state }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: UpdateState | null;
}) {
  const { t, locale } = useI18n();
  const st = state?.status ?? "idle";
  const version = state?.version ?? "";
  const pct = clampPercent(state?.progress);
  const hasNotes = Boolean(state?.releaseNotes) && (st === "available" || st === "downloading" || st === "downloaded" || st === "installing");

  const heading = headline(t, state);
  const released = state?.releaseDate ? new Date(state.releaseDate) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-pane-raised">
              <ZekraMark size={26} />
            </span>
            <div className="min-w-0">
              <DialogTitle>{t("dupd.title")}</DialogTitle>
              <DialogDescription>
                <span dir="ltr" className="font-grid-mono text-xs" style={{ unicodeBidi: "isolate" }}>
                  {t("dupd.current")}: {state?.currentVersion ?? ""}
                  {state?.channel === "beta" ? ` · ${t("dupd.beta")}` : ""}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {state?.critical && (st === "downloading" || st === "downloaded" || st === "available") ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div className="text-ui-sm">
                <div className="font-medium">{t("dupd.critical")}</div>
                <div className="opacity-90">{t("dupd.criticalBody")}</div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <div className="text-[15px] font-medium text-foreground">{heading}</div>
            {released && !Number.isNaN(released.getTime()) && hasNotes ? (
              <div className="text-xs text-muted-foreground">{t("dupd.released", { date: released.toLocaleDateString(locale) })}</div>
            ) : null}
            {st === "error" && state?.message ? (
              <div className="text-xs break-words text-destructive">{state.message}</div>
            ) : null}
          </div>

          {st === "downloading" || st === "available" ? (
            <div className="flex flex-col gap-1.5">
              <Progress value={st === "available" ? null : pct} />
              <div dir="ltr" className="flex justify-between gap-2 font-grid-mono text-[11.5px] text-muted-foreground" style={{ unicodeBidi: "isolate" }}>
                <span>
                  {st === "downloading" ? `${Math.round(pct)}%` : ""}
                  {formatTransfer(state?.transferred, state?.total) ? ` · ${formatTransfer(state?.transferred, state?.total)}` : ""}
                </span>
                <span>
                  {formatSpeed(state?.bytesPerSecond)}
                  {eta(t, state) ? ` · ${eta(t, state)}` : ""}
                </span>
              </div>
            </div>
          ) : null}

          {hasNotes ? (
            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border/60 bg-pane-raised/50 px-3 py-2 text-ui-sm">
              <Markdown text={state?.releaseNotes ?? ""} />
            </div>
          ) : st === "downloaded" ? (
            <p className="text-ui-sm text-muted-foreground">{t("dupd.noNotes")}</p>
          ) : null}
        </div>

        <DialogFooter>
          {st === "downloaded" ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  snooze();
                  onOpenChange(false);
                }}
              >
                {t("dupd.later")}
              </Button>
              <Button onClick={installNow}>
                <Download />
                {t("dupd.restart")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("dupd.close")}
              </Button>
              <Button disabled={!canCheck(state) || st === "disabled"} onClick={() => void bridge().checkForUpdates()}>
                <RefreshCw className={st === "checking" ? "animate-spin" : undefined} />
                {t("dupd.check")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function headline(t: TFn, state: UpdateState | null): string {
  const version = state?.version ?? "";
  switch (state?.status ?? "idle") {
    case "checking":
      return t("dupd.checking");
    case "available":
      return t("dupd.available", { version });
    case "downloading":
      return t("dupd.downloading", { version });
    case "downloaded":
      return t("dupd.ready", { version });
    case "installing":
      return t("dupd.installing");
    case "not-available":
      return t("dupd.upToDate", { version: state?.currentVersion ?? version });
    case "disabled":
      return t("dupd.disabled");
    case "error":
      return t("dupd.error");
    default:
      return t("settingsx.update.idle");
  }
}

function eta(t: TFn, state: UpdateState | null): string {
  const s = etaSeconds(state?.transferred, state?.total, state?.bytesPerSecond);
  if (s === null || s <= 0) return "";
  const time = s < 60 ? t("dupd.seconds", { n: s }) : t("dupd.minutes", { n: Math.ceil(s / 60) });
  return t("dupd.eta", { time });
}
