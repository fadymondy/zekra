import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

import { confirmIdentity } from "@/features/vault/device-auth";
import type { GateDecision } from "@/features/vault/vault-core";

import { biometricAvailability, biometricKind, type BiometricAvailability, type BiometricKind } from "./lock-core";

export type BiometricInfo = { kind: BiometricKind; availability: BiometricAvailability };

/** What the device offers right now (enrolment can change while the app runs). */
export async function biometricInfo(): Promise<BiometricInfo> {
  if (Platform.OS === "web") return { kind: "biometrics", availability: "noHardware" };
  try {
    const [hardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return { kind: biometricKind(types, Platform.OS), availability: biometricAvailability(hardware, enrolled) };
  } catch {
    return { kind: "biometrics", availability: "noHardware" };
  }
}

/**
 * Face ID / Touch ID / fingerprint, with the device passcode as the system's
 * own fallback — the vault's gate (src/features/vault/device-auth.ts), so a
 * device with no authenticator at all proceeds rather than locking its owner
 * out: removing every biometric AND the passcode already took the passcode.
 */
export function confirmOwner(promptMessage: string, cancelLabel: string, fallbackLabel?: string): Promise<GateDecision> {
  return confirmIdentity(promptMessage, cancelLabel, { fallbackLabel });
}

/** The device's biometric, re-read whenever the app comes back to the foreground
 *  (the user may have just enrolled a face or finger in the system settings). */
export function useBiometricInfo(): BiometricInfo | null {
  const [info, setInfo] = useState<BiometricInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => void biometricInfo().then((next) => alive && setInfo(next));
    refresh();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return info;
}
