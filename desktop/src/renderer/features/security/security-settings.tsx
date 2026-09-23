import { useEffect, useState } from "react";
import { Fingerprint, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { useI18n, type TKey } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { Group, Row, Segmented } from "../settings/ui";
import { LOCK_MINUTES, lockState } from "./lock-state";
import { promptTouchId, touchIdAvailable } from "./touch-id";

/*
Settings ▸ Security (MH-450): "Unlock with Touch ID" and "Require after".
Mounted by the Settings window (screens/settings-window.tsx), "security"
section, in the desktop's grouped rows. Turning the lock on
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
    <>
      <Group>
        <Row
          label={
            <span className="flex items-center gap-2">
              <Fingerprint className="size-4 text-muted-foreground" strokeWidth={1.75} />
              {t("security.unlockWith", { kind })}
            </span>
          }
          hint={
            <>
              {t("desk.lock.unlockBody")}
              {available === false ? <span className="mt-0.5 block text-grid-warn">{t("desk.lock.noTouchId")}</span> : null}
            </>
          }
        >
          <Switch
            id="zekra-lock-switch"
            aria-label={t("security.unlockWith", { kind })}
            checked={lock.enabled}
            disabled={busy || available === null || (!lock.enabled && !canEnable)}
            onCheckedChange={(next) => void toggle(next)}
          />
        </Row>
        <Row label={t("security.requireAfter")} hint={t("desk.lock.requireAfterBody")}>
          <span className={cn(!lock.enabled && "pointer-events-none opacity-50")} aria-disabled={!lock.enabled || busy}>
            <Segmented<string>
              label={t("security.requireAfter")}
              value={String(minutes)}
              onChange={(v) => void patch({ lock: { ...lock, timeoutMinutes: Number(v) } })}
              options={LOCK_MINUTES.map((m) => ({ value: String(m), label: t(AFTER_KEY[m]) }))}
            />
          </span>
        </Row>
        {lock.enabled ? (
          <Row label={t("desk.lock.lockNow")} hint={t("desk.lock.statusOn", { after: afterLabel })}>
            <Button variant="outline" size="sm" onClick={() => lockState.setLocked(true)}>
              <Lock />
              {t("desk.lock.lockNow")}
            </Button>
          </Row>
        ) : null}
      </Group>
      {!lock.enabled ? <p className="-mt-3 px-1 text-[13px] text-muted-foreground">{t("desk.lock.statusOff")}</p> : null}
    </>
  );
}
