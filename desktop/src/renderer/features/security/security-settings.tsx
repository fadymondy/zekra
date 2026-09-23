import { useEffect, useState } from "react";
import { Fingerprint, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useI18n, type TKey } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { LOCK_MINUTES, lockState } from "./lock-state";
import { promptTouchId, touchIdAvailable } from "./touch-id";

/*
Settings ▸ Security (MH-450): "Unlock with Touch ID" and "Require after".
Mounted by routes/settings.tsx in the "security" section. Turning the lock on
or off asks for Touch ID first (as mobile does), so the switch cannot be
flipped by whoever is at an unlocked Mac. Without Touch ID the controls are
disabled with the reason; a lock that is already on can still be turned off.
*/

const AFTER_KEY: Record<number, TKey> = {
  0: "security.after.0",
  1: "security.after.60",
  5: "security.after.300",
  15: "security.after.900",
};

export function SecuritySettings() {
  const { t } = useI18n();
  const { settings, patch } = useSession();
  const lock = settings.lock;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const kind = t("desk.lock.touchId");

  useEffect(() => {
    let alive = true;
    const check = () => void touchIdAvailable().then((ok) => alive && setAvailable(ok));
    check();
    // A lid opened / Touch ID set up in System Settings meanwhile.
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      window.removeEventListener("focus", check);
    };
  }, []);

  async function toggle(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const out = await promptTouchId(next ? "turn on Touch ID unlock for Zekra" : "turn off Touch ID unlock for Zekra");
      // Turning OFF with no Touch ID reachable (lid closed): allowed — the Mac
      // is already unlocked and the user is signed in; nothing is exposed that
      // the unlocked app does not already show.
      if (out === "proceed" || (!next && out === "unavailable")) {
        await patch({ lock: { ...lock, enabled: next, touchId: true, offered: true } });
        if (next) toast.success(t("security.enabledToast", { kind }));
      } else if (out === "failed") {
        toast.error(t("security.failed"));
      } else if (out === "unavailable") {
        setAvailable(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const minutes = LOCK_MINUTES.includes(lock.timeoutMinutes) ? lock.timeoutMinutes : 5;
  const canEnable = available === true;
  const afterLabel = t(AFTER_KEY[minutes] ?? "security.after.300");

  return (
    <div className="flex flex-col gap-6">
      {/* The section title comes from the settings route's SettingsHeader. */}
      <p className="text-xs text-muted-foreground">
        {lock.enabled ? t("desk.lock.statusOn", { after: afterLabel }) : t("desk.lock.statusOff")}
      </p>

      <div className="flex items-start gap-4 rounded-md border border-border/60 bg-pane-raised p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 text-grid-gold">
          <Fingerprint className="size-5" strokeWidth={1.6} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor="zekra-lock-switch" className="text-sm font-medium">
            {t("security.unlockWith", { kind })}
          </Label>
          <p className="text-xs text-muted-foreground">{t("desk.lock.unlockBody")}</p>
          {available === false ? <p className="text-xs text-grid-warn">{t("desk.lock.noTouchId")}</p> : null}
        </div>
        <Switch
          id="zekra-lock-switch"
          checked={lock.enabled}
          disabled={busy || available === null || (!lock.enabled && !canEnable)}
          onCheckedChange={(next) => void toggle(next)}
        />
      </div>

      <div className={cn("flex flex-col gap-2", !lock.enabled && "opacity-60")}>
        <Label className="text-sm font-medium">{t("security.requireAfter")}</Label>
        <p className="text-xs text-muted-foreground">{t("desk.lock.requireAfterBody")}</p>
        <div role="radiogroup" aria-label={t("security.requireAfter")} className="flex flex-wrap gap-2">
          {LOCK_MINUTES.map((m) => (
            <Button
              key={m}
              role="radio"
              aria-checked={minutes === m}
              size="sm"
              variant={minutes === m ? "default" : "outline"}
              disabled={!lock.enabled || busy}
              onClick={() => void patch({ lock: { ...lock, timeoutMinutes: m } })}
            >
              {t(AFTER_KEY[m])}
            </Button>
          ))}
        </div>
      </div>

      {lock.enabled ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => lockState.setLocked(true)}>
            <Lock />
            {t("desk.lock.lockNow")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
