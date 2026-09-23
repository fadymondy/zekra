import { requireOptionalNativeModule } from "expo";
import { Platform, TurboModuleRegistry } from "react-native";

// Whether a native module is in THIS binary. A dev client or store build from
// before social sign-in was added lacks them, and several of these libraries
// look their module up eagerly (requireNativeModule throws at import). So the
// sign-in code checks first and loads the library only when it is really there
// — a missing module hides its button instead of crashing the app.
export function hasExpoModule(name: string): boolean {
  if (Platform.OS === "web") return false;
  try {
    return requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
}

export function hasTurboModule(name: string): boolean {
  if (Platform.OS === "web") return false;
  try {
    return TurboModuleRegistry.get(name) != null;
  } catch {
    return false;
  }
}

type Crypto = typeof import("expo-crypto");

/** expo-crypto, loaded on first use (its module is required, not optional, at import). */
export function loadCrypto(): Crypto | null {
  if (!hasExpoModule("ExpoCrypto")) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-crypto") as Crypto;
}
