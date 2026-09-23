import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { lockOnLaunch, shouldLockOnReturn, shouldOffer } from "@mobile/features/security/lock-core";

import { COMMANDS } from "../../../shared/ipc";
import { ZekraMark } from "../../components/zekra-mark";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useCommands } from "../../shell/commands";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { afterSeconds, lockState, useLockState } from "./lock-state";
import { promptTouchId, touchIdAvailable } from "./touch-id";

/*
The Touch ID app lock (MH-450), ported from mobile's app-lock-gate.tsx over
the pure rules in mobile/src/features/security/lock-core.ts. Mounted once in
app.tsx, inside the providers, next to the shell.

  - Launch: a signed-in user (session restored from the store) with the lock
    on starts locked — decided before the first paint, so content never
    flashes.
  - Background: main reports app activation (src/main/app-activity.ts).
    Leaving records the time; coming back past "Require after" locks again.
    Locking the Mac's screen or sleeping locks at once. The app's own Touch ID
    / confirm prompts never count as leaving.
  - While locked, the content is covered by an opaque navy overlay, focus and
    keys cannot reach it, and menu commands are swallowed (except Sign out).
  - After a sign-in in this run (not a restored session) on a Mac with Touch
    ID, a one-time dialog offers to turn the lock on; the answer is kept.

It is a local guard for a Mac left unlocked; the server session is the
access control. There is no password fallback on a Mac without Touch ID
available at unlock time (lid closed): the way out is Sign out.
*/


// Module-level on purpose: app.tsx re-keys the RouterProvider (and so this
// gate) per account, and a remount must neither re-run the launch decision
// nor forget which session it last saw.
let launchDecided = false;
/** undefined = no session seen yet in this renderer. */
let seenToken: string | null | undefined;
let backgroundedAt: number | null = null;

export function AppLockGate() {
  const { settings, patch, user, token } = useSession();
  const { locked, prompting } = useLockState();
  const lock = settings.lock;
  const signedIn = Boolean(user && token);
  const guarded = signedIn && lock.enabled;
  const [offer, setOffer] = useState(false);

  // Latest values for the long-lived activity listener.
  const live = useRef({ lock, signedIn });
  live.current = { lock, signedIn };

  // Launch: decide once per renderer, before paint.
  useLayoutEffect(() => {
    if (launchDecided) return;
    launchDecided = true;
    if (lockOnLaunch(lock, Boolean(settings.authToken))) lockState.setLocked(true);
  }, [lock, settings.authToken]);

  // Signed out (here, from the lock, or a revoked session): nothing to guard.
  // The lock turned off in Settings: unlock too.
  useEffect(() => {
    if (!signedIn || !lock.enabled) lockState.setLocked(false);
  }, [signedIn, lock.enabled]);

  // Background / foreground / system lock.
  useEffect(
    () =>
      bridge().onAppActivity((e) => {
        const { lock: l, signedIn: s } = live.current;
        const on = s && l.enabled;
        if (!on || lockState.get().prompting) return;
        if (e.state === "system-lock") {
          lockState.setLocked(true);
          backgroundedAt = null;
        } else if (e.state === "background") {
          backgroundedAt ??= Date.now();
        } else {
          if (shouldLockOnReturn({ enabled: l.enabled, after: afterSeconds(l) }, s, backgroundedAt, Date.now())) {
            lockState.setLocked(true);
          }
          backgroundedAt = null;
        }
      }),
    [],
  );

  // A sign-in in this run (not a restored session): maybe offer the lock.
  useEffect(() => {
    const fresh = seenToken !== undefined && !seenToken && Boolean(token);
    seenToken = token;
    if (!fresh) return;
    let alive = true;
    void (async () => {
      const ready = await touchIdAvailable();
      const l = live.current.lock;
      const decide = { enabled: l.enabled, after: afterSeconds(l), offered: Boolean(l.offered) };
      if (!alive || !shouldOffer(decide, true, ready ? "ready" : "noHardware")) return;
      // Let the hand-off to Brains finish first.
      setTimeout(() => alive && setOffer(true), 700);
    })();
    return () => {
      alive = false;
    };
  }, [token]);

  const showLock = guarded && locked;
  return (
    <>
      {showLock ? <LockScreen /> : null}
      <SwallowCommands active={showLock} />
      <EnableOffer
        open={offer && signedIn && !showLock && !prompting}
        onClose={() => setOffer(false)}
        onAnswer={(enabled) => void patch({ lock: { ...settings.lock, enabled: enabled || settings.lock.enabled, offered: true } })}
      />
    </>
  );
}

/** While locked, every menu / tray command stops here — except Sign out and About. */
function SwallowCommands({ active }: { active: boolean }) {
  const { register } = useCommands();
  useEffect(() => {
    if (!active) return;
    const offs = COMMANDS.map((name) => register(name, () => (name === "sign-out" || name === "about" ? false : undefined)));
    return () => offs.forEach((off) => off());
  }, [active, register]);
  return null;
}

function LockScreen() {
  const { t } = useI18n();
  const { user, signOut } = useSession();
  const root = useRef<HTMLDivElement>(null);
  const unlockBtn = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const kind = t("desk.lock.touchId");

  const unlock = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const out = await promptTouchId("unlock Zekra");
      if (out === "proceed") lockState.setLocked(false);
      else if (out === "unavailable") setError(t("desk.lock.unavailableNow"));
      else if (out === "failed") setError(t("lock.failed"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [t]);

  // Prompt at once when the lock appears (or when the window first gets
  // focus), and again each time the app comes back from the background — but
  // not after the prompt's own resign/become-active bounce, or a cancel would
  // loop straight back into the prompt.
  useEffect(() => {
    let away = false;
    const onFirstFocus = () => void unlock();
    if (document.hasFocus()) void unlock();
    else window.addEventListener("focus", onFirstFocus, { once: true });
    const off = bridge().onAppActivity((e) => {
      if (lockState.get().prompting) return;
      if (e.state !== "active") away = true;
      else if (away) {
        away = false;
        void unlock();
      }
    });
    return () => {
      window.removeEventListener("focus", onFirstFocus);
      off();
    };
  }, [unlock]);

  // Keep focus and keys inside the lock.
  useEffect(() => {
    unlockBtn.current?.focus();
    const inside = (n: EventTarget | null) => n instanceof Node && !!root.current?.contains(n);
    const onFocus = (e: FocusEvent) => {
      if (!inside(e.target)) unlockBtn.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!inside(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="zekra-lock-title"
      // The theme's own ground (every colour comes from the theme tokens).
      className="app-chrome fixed inset-0 z-[400] flex flex-col bg-background text-foreground"
    >
      {/* The window stays draggable by its top edge; the traffic lights sit above. */}
      <div className="app-drag shrink-0" style={{ height: "var(--titlebar-h)" }} />
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 pb-6">
        <ZekraMark size={72} />
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <h1 id="zekra-lock-title" className="text-xl font-semibold text-foreground">
            {t("lock.title")}
          </h1>
          <p className="text-sm font-light text-muted-foreground">{t("lock.body", { kind })}</p>
          {user?.email ? (
            <p dir="ltr" className="max-w-full truncate font-mono text-xs text-muted-foreground" style={{ unicodeBidi: "isolate" }}>
              {user.email}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col items-center gap-3 pb-12">
        <button
          ref={unlockBtn}
          type="button"
          disabled={busy}
          onClick={() => void unlock()}
          aria-label={t("lock.unlock", { kind })}
          className="app-no-drag flex size-[76px] items-center justify-center rounded-full border border-border/60 transition-colors hover:border-primary hover:bg-accent-tint focus-visible:border-primary focus-visible:outline-none disabled:opacity-70"
        >
          {busy ? (
            <Loader2 className="size-8 animate-spin" style={{ color: "var(--grid-action)" }} strokeWidth={1.5} />
          ) : (
            <Fingerprint className="size-9" style={{ color: "var(--grid-action)" }} strokeWidth={1.5} />
          )}
        </button>
        <span className="text-sm text-foreground">{t("lock.unlock", { kind })}</span>
        {error ? (
          <p role="alert" className="flex max-w-md items-start gap-2 px-6 text-start text-xs text-destructive">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 bg-grid-danger" />
            {error}
          </p>
        ) : null}
        <Button variant="ghost" size="sm" className="app-no-drag text-muted-foreground" onClick={() => void signOut().then(() => lockState.setLocked(false))}>
          {t("action.signOut")}
        </Button>
      </div>
    </div>
  );
}

/** One-time offer after a sign-in: "Lock Zekra with Touch ID?" */
function EnableOffer({ open, onClose, onAnswer }: { open: boolean; onClose: () => void; onAnswer: (enabled: boolean) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const kind = t("desk.lock.touchId");

  const decline = () => {
    onAnswer(false);
    onClose();
  };
  const accept = async () => {
    setBusy(true);
    try {
      // Confirming first proves the sensor works for this user.
      const out = await promptTouchId("turn on Touch ID unlock for Zekra");
      if (out === "cancel") return; // keep the dialog: they may try again or say not now
      if (out === "proceed") {
        onAnswer(true);
        toast.success(t("security.enabledToast", { kind }));
      } else {
        onAnswer(false);
        toast.error(t("security.failed"));
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) decline(); }}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="size-5 text-primary" strokeWidth={1.6} />
            {t("lock.offerTitle", { kind })}
          </DialogTitle>
          <DialogDescription>{t("lock.offerBody", { kind })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={decline}>
            {t("lock.offerNo")}
          </Button>
          <Button disabled={busy} onClick={() => void accept()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {t("lock.offerYes", { kind })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
