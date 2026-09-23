// Pure app-lock logic (MH-360): no React Native imports, so `node --test` can
// exercise it directly (lock-core.test.ts). The React side is lock-store.ts
// (settings + locked state) and app-lock-gate.tsx (the lock screen).

/** Seconds the app may spend in the background before it locks again. */
export type LockAfter = 0 | 60 | 300 | 900;

export const LOCK_AFTER: readonly LockAfter[] = [0, 60, 300, 900];

export type LockSettings = {
  /** Unlock with biometrics (device passcode as the fallback). */
  enabled: boolean;
  after: LockAfter;
  /** The "turn it on?" offer after a first sign-in was answered, either way. */
  offered: boolean;
};

export const DEFAULT_LOCK: LockSettings = { enabled: false, after: 0, offered: false };

/** Stored JSON -> settings; anything unreadable is the default (lock off). */
export function parseLockSettings(raw: string | null | undefined): LockSettings {
  if (!raw) return { ...DEFAULT_LOCK };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LOCK };
  }
  if (!value || typeof value !== "object") return { ...DEFAULT_LOCK };
  const v = value as Record<string, unknown>;
  return {
    enabled: v.enabled === true,
    after: (LOCK_AFTER as readonly unknown[]).includes(v.after) ? (v.after as LockAfter) : DEFAULT_LOCK.after,
    offered: v.offered === true,
  };
}

export function serializeLockSettings(s: LockSettings): string {
  return JSON.stringify({ enabled: s.enabled, after: s.after, offered: s.offered });
}

/** At launch, once the session is restored: lock a signed-in user who turned the lock on. */
export function lockOnLaunch(settings: Pick<LockSettings, "enabled">, signedIn: boolean): boolean {
  return settings.enabled && signedIn;
}

/**
 * Back from the background at `now` (ms), having left at `backgroundedAt`.
 * A clock that went backwards fails closed (locks): the threshold cannot be
 * trusted, and one extra prompt is the cheap side.
 */
export function shouldLockOnReturn(
  settings: Pick<LockSettings, "enabled" | "after">,
  signedIn: boolean,
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (!settings.enabled || !signedIn || backgroundedAt === null) return false;
  if (now < backgroundedAt) return true;
  return now - backgroundedAt >= settings.after * 1000;
}

/** Offer the lock once, right after a sign-in on this device, where biometrics are set up. */
export function shouldOffer(settings: LockSettings, freshSignIn: boolean, availability: BiometricAvailability): boolean {
  return freshSignIn && !settings.enabled && !settings.offered && availability === "ready";
}

// expo-local-authentication's AuthenticationType values.
const FINGERPRINT = 1;
const FACIAL = 2;
const IRIS = 3;

export type BiometricKind = "faceId" | "touchId" | "face" | "fingerprint" | "iris" | "biometrics";

/**
 * What to call the device's biometric in the UI. iOS has one (Face ID or Touch
 * ID). Android may report several; a fingerprint sensor is the one people use
 * most, so it wins, then face, then iris.
 */
export function biometricKind(types: readonly number[], os: string): BiometricKind {
  if (os === "ios") {
    if (types.includes(FACIAL)) return "faceId";
    if (types.includes(FINGERPRINT)) return "touchId";
    return "biometrics";
  }
  if (types.includes(FINGERPRINT)) return "fingerprint";
  if (types.includes(FACIAL)) return "face";
  if (types.includes(IRIS)) return "iris";
  return "biometrics";
}

export type BiometricAvailability = "ready" | "notEnrolled" | "noHardware";

/** The lock needs biometrics that are set up (the passcode is only the fallback). */
export function biometricAvailability(hasHardware: boolean, enrolled: boolean): BiometricAvailability {
  if (!hasHardware) return "noHardware";
  return enrolled ? "ready" : "notEnrolled";
}
