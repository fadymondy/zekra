import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";

import type { UpdateState } from "../../../shared/ipc";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useCommand } from "../../shell/commands";
import { useSlot } from "../../shell/slots";
import { toast } from "../../shell/toast";
import { ProgressRing } from "./progress-ring";
import { UpdateSheet } from "./update-sheet";
import { canCheck, installNow, onOpenUpdateSheet, openUpdateSheet, snooze, useUpdateState } from "./use-update";

/*
Software Update, renderer side — mounted once per main window
(features/open-file/host.tsx):

  loader      a compact line in the sidebar footer ("sidebar.status" slot):
              a spinning ring while checking, a progress ring + % while
              downloading, "Restart to update" once ready. Click = the sheet.
              Hidden when there is nothing to say.
  ready card  a persistent toast "Zekra X.Y.Z is ready — Restart to Update /
              Later" whenever the main process's policy says prompt
              (state.prompt; src/main/update-policy.ts). Later snoozes it.
              Critical releases are also prompted with a native sheet by main.
  sheet       UpdateSheet, opened from the loader, the card, Settings ▸ About
              and Help ▸ Check for Updates… / the tray ("update:show").
*/
export function UpdateHost() {
  const { t } = useI18n();
  const state = useUpdateState();
  const [open, setOpen] = useState(false);
  const latest = useRef<UpdateState | null>(null);
  latest.current = state;

  useEffect(
    () =>
      onOpenUpdateSheet((checkNow) => {
        setOpen(true);
        if (checkNow && canCheck(latest.current)) void bridge().checkForUpdates();
      }),
    [],
  );
  useCommand("update:show", () => openUpdateSheet(true));

  // The ready card, once per version while the policy wants the user asked.
  const cardFor = useRef("");
  useEffect(() => {
    const ready = state?.status === "downloaded" && state.prompt;
    const id = `zekra-update-${state?.version ?? ""}`;
    if (!ready) {
      if (cardFor.current) toast.dismiss(cardFor.current);
      cardFor.current = "";
      return;
    }
    if (cardFor.current === id) return;
    cardFor.current = id;
    toast(t("dupd.ready", { version: state.version ?? "" }), {
      id,
      description: state.critical ? t("dupd.criticalBody") : t("dupd.readyBody"),
      icon: state.critical ? <AlertTriangle className="size-4 text-amber-500" /> : <Download className="size-4" />,
      duration: Infinity,
      action: { label: t("dupd.restart"), onClick: installNow },
      cancel: { label: t("dupd.later"), onClick: snooze },
    });
  }, [state?.status, state?.prompt, state?.version, state?.critical, t]);

  const loader = useMemo(() => <UpdateLoader state={state} />, [state]);
  useSlot("sidebar.status", loader, { order: 90 });

  return <UpdateSheet open={open} onOpenChange={setOpen} state={state} />;
}

/** The sidebar-footer line. Nothing while idle / up to date / disabled. */
function UpdateLoader({ state }: { state: UpdateState | null }) {
  const { t } = useI18n();
  const st = state?.status;
  if (st !== "downloading" && st !== "available" && st !== "downloaded" && st !== "installing") return null;
  const pct = Math.round(state?.progress ?? 0);
  const ready = st === "downloaded";
  const label =
    st === "downloading"
      ? t("dupd.downloadingShort", { progress: pct })
      : st === "available"
        ? t("dupd.available", { version: state?.version ?? "" })
        : st === "installing"
          ? t("dupd.installing")
          : t("dupd.readyShort");
  return (
    <button
      type="button"
      onClick={() => (ready ? installNow() : openUpdateSheet())}
      onContextMenu={(e) => {
        e.preventDefault();
        openUpdateSheet();
      }}
      title={ready ? t("dupd.ready", { version: state?.version ?? "" }) : t("dupd.title")}
      className={
        ready
          ? "flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-ui-sm font-medium text-primary hover:bg-sidebar-accent"
          : "flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-ui-sm text-muted-foreground hover:bg-sidebar-accent"
      }
    >
      {ready ? (
        state?.critical ? <AlertTriangle className="size-3.5 shrink-0 text-amber-500" /> : <Download className="size-3.5 shrink-0" />
      ) : (
        <ProgressRing value={pct} indeterminate={st !== "downloading"} />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
