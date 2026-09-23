// Pure OS-version logic behind src/lib/platform.ts (no react-native import, so
// `node --test` can run it).

/** Liquid Glass (and the native tab bar / bottom search field that come with
 *  it) arrived with iOS 26. */
export const LIQUID_GLASS_MIN_IOS = 26;

/**
 * The major version out of React Native's `Platform.Version`. On iOS that is a
 * string ("27.0", "26.0.1", occasionally "26"); on Android it is the API
 * level as a number. Anything unparseable is 0, so it never passes a gate.
 */
export function majorVersion(version: string | number | null | undefined): number {
  if (typeof version === "number") return Number.isFinite(version) && version > 0 ? Math.floor(version) : 0;
  if (typeof version !== "string") return 0;
  const match = /^\s*(\d+)/.exec(version);
  return match ? Number(match[1]) : 0;
}

/** True on iOS 26+ only — Android API levels never count, whatever the number. */
export function isLiquidGlassOS(os: string, version: string | number | null | undefined): boolean {
  return os === "ios" && majorVersion(version) >= LIQUID_GLASS_MIN_IOS;
}
