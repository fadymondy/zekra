import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";
import { Platform } from "react-native";

import { isLiquidGlassOS } from "./platform-core";

// The one place that decides "new iOS" (MH-360). iOS 26+ gets the native
// Liquid Glass navigation — native tab bar, native search, glass header
// controls; older iOS and Android keep the house-style chrome unchanged.

let liquidGlass: boolean | undefined;
let glassEffect: boolean | undefined;

/** iOS 26 or newer. Constant for the life of the process. */
export function isLiquidGlass(): boolean {
  if (liquidGlass === undefined) liquidGlass = isLiquidGlassOS(Platform.OS, Platform.Version);
  return liquidGlass;
}

/**
 * Whether a `GlassView` will actually render glass: iOS 26+, the app isn't
 * opted out via `UIDesignRequiresCompatibility`, and the runtime has the
 * UIGlassEffect API (some 26 betas lacked it). Guarded so a binary without the
 * ExpoGlassEffect module degrades to the translucent fallback instead of
 * throwing.
 */
export function hasGlassEffect(): boolean {
  if (glassEffect === undefined) {
    try {
      glassEffect = isLiquidGlass() && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
    } catch {
      glassEffect = false;
    }
  }
  return glassEffect;
}
