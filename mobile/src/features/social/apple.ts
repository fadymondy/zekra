import { Platform } from "react-native";

import { joinName } from "./social-core";
import { hasExpoModule, loadCrypto } from "./native";

// Sign in with Apple (expo-apple-authentication), iOS only. The identity token
// goes to POST /api/auth/apple/token, which verifies it against Apple's keys
// (audience = the bundle id, APPLE_BUNDLE_IDS) and answers exactly what a
// password sign-in answers — internal/account/oauth_apple.go.

type AppleLib = typeof import("expo-apple-authentication");

export function loadApple(): AppleLib | null {
  if (Platform.OS !== "ios" || !hasExpoModule("ExpoAppleAuthentication")) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-apple-authentication") as AppleLib;
}

export async function appleAvailable(): Promise<boolean> {
  const lib = loadApple();
  if (!lib || !loadCrypto()) return false;
  try {
    return await lib.isAvailableAsync();
  } catch {
    return false;
  }
}

export type AppleCredential = { identityToken: string; nonce: string; fullName: string };

/** Apple's sheet -> an identity token. null when the user closed the sheet. */
export async function appleCredential(): Promise<AppleCredential | null> {
  const lib = loadApple();
  const Crypto = loadCrypto();
  if (!lib || !Crypto) throw new Error("Sign in with Apple is not available in this build");
  // Apple gets the SHA-256 of the nonce; the API gets the raw value and hashes
  // it to compare, so a token lifted from one sign-in cannot be replayed.
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const cred = await lib.signInAsync({
      requestedScopes: [lib.AppleAuthenticationScope.FULL_NAME, lib.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!cred.identityToken) throw new Error("Apple returned no identity token");
    return { identityToken: cred.identityToken, nonce, fullName: joinName(cred.fullName) };
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_REQUEST_CANCELED") return null;
    throw error;
  }
}
