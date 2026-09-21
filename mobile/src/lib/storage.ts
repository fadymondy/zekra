import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// expo-secure-store is native-only: on web every call throws/no-ops, so the
// locale, theme and sign-in session all silently failed to persist there (the
// web preview always bounced back to sign-in).
//
// Native keeps the Keychain / Keystore. Web falls back to localStorage, which
// is NOT equivalent security: it is readable by any script on the origin. That
// is acceptable for the dev/preview web build, which is not a shipped surface —
// the released product is the native app. Do not ship a web build that holds a
// real session without revisiting this.
const webStore = {
  getItem(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {}
  },
  removeItem(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {}
  },
};

export async function getStored(key: string): Promise<string | null> {
  if (Platform.OS === "web") return webStore.getItem(key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setStored(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return webStore.setItem(key, value);
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {}
}

export async function removeStored(key: string): Promise<void> {
  if (Platform.OS === "web") return webStore.removeItem(key);
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}
