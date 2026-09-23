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
 * plugin entry in app.json.
 */
export async function confirmIdentity(promptMessage: string, cancelLabel: string): Promise<GateDecision> {
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
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false,
    });
    return gateDecision(level, result);
  } catch {
    return "failed";
  }
}
