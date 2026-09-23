import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";

import { gateDecision, SECURITY_LEVEL_NONE, type GateDecision } from "./vault-core";

/**
 * Ask the device owner to confirm with Face ID / Touch ID / fingerprint, or the
 * device passcode (disableDeviceFallback: false), before a secret is revealed.
 *
 * This is a local speed bump for a phone left unlocked on a desk, not the
 * access control: the server only reveals to a caller with write access on the
 * brain. So a device with no authenticator at all (no passcode, no biometrics)
 * proceeds without a prompt — refusing would lock those users out of their own
 * secrets while adding no real protection. A cancel aborts; a lockout or failed
 * match blocks. See gateDecision in vault-core.ts.
 *
 * NSFaceIDUsageDescription comes from the expo-local-authentication config
 * plugin entry in app.json. The app lock (src/features/security) unlocks
 * through this same gate.
 */
// A system auth prompt makes iOS report the app "inactive". The app lock's
// app-switcher cover keys off that state, so it asks here first and stays out
// of the way of the app's own prompts (src/features/security/app-lock-gate.tsx).
let prompts = 0;
export function authPromptShowing(): boolean {
  return prompts > 0;
}

export async function confirmIdentity(
  promptMessage: string,
  cancelLabel: string,
  /** iOS: the label of the passcode button the prompt shows after a failed match. */
  options: { fallbackLabel?: string } = {},
): Promise<GateDecision> {
  // The web build has no local authenticator; the server check still applies.
  if (Platform.OS === "web") return "proceed";
  let level: number;
  try {
    level = await LocalAuthentication.getEnrolledLevelAsync();
  } catch {
    // The native module failing is not "no authenticator": fail closed.
    return "failed";
  }
  if (level === SECURITY_LEVEL_NONE) return gateDecision(level, null);
  prompts++;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false,
      ...(options.fallbackLabel ? { fallbackLabel: options.fallbackLabel } : {}),
    });
    return gateDecision(level, result);
  } catch {
    return "failed";
  } finally {
    prompts--;
  }
}
