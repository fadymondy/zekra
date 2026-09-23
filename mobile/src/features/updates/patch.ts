import Constants from "expo-constants";
import { Platform, TurboModuleRegistry } from "react-native";

/*
The Codemagic Patch SDK, loaded lazily and only where it can work.

@codemagic/react-native-patch resolves its native TurboModule with
getEnforcing() AT IMPORT TIME: importing it into a binary that was built
before the package was added (an installed dev client, an older TestFlight
build) would throw during bundle evaluation and crash the app on launch. So
nothing imports it statically; patch() requires it only when

  - this is a release build (debug builds load JS from Metro — OTA does not
    apply there),
  - the binary was built WITH the Patch config plugin for this platform
    (app.config.js sets extra.patch — deployment key + public key present),
  - and the native module is actually registered.

Otherwise patch() is null and every updater path is a no-op.
*/

export type PatchSdk = typeof import("@codemagic/react-native-patch");

type PatchExtra = { enabled?: boolean; ios?: boolean; android?: boolean; deployment?: string };

export function patchExtra(): PatchExtra {
  const extra = (Constants.expoConfig?.extra ?? {}) as { patch?: PatchExtra };
  return extra.patch ?? {};
}

/** The deployment this binary follows ("Production" / "Staging"), or null when OTA is off. */
export function patchDeployment(): string | null {
  return configuredForPlatform() ? (patchExtra().deployment ?? "Production") : null;
}

function configuredForPlatform(): boolean {
  const extra = patchExtra();
  if (!extra.enabled) return false;
  if (Platform.OS === "ios") return Boolean(extra.ios);
  if (Platform.OS === "android") return Boolean(extra.android);
  return false;
}

let cached: PatchSdk | null | undefined;

export function patch(): PatchSdk | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (__DEV__ || !configuredForPlatform()) return cached;
  try {
    if (!TurboModuleRegistry.get("NativeCodemagicPatch")) return cached;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("@codemagic/react-native-patch") as PatchSdk;
  } catch (e) {
    console.warn("[updates] Codemagic Patch unavailable:", e);
    cached = null;
  }
  return cached;
}

/** Why OTA is off (for Settings ▸ About). */
export function patchUnavailableReason(): "dev" | "not-configured" | "no-native-module" | null {
  if (__DEV__) return "dev";
  if (!configuredForPlatform()) return "not-configured";
  return patch() ? null : "no-native-module";
}
