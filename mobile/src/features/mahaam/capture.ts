import { Dimensions, PixelRatio, Platform } from "react-native";

import type { Attachment } from "./client";
import { getCurrentRoute, sensitiveOnScreen } from "./diagnostics";
import { autoCaptureAllowed, captureSize } from "./mahaam-core";

type ViewShot = typeof import("react-native-view-shot");

// Loaded on first use, not at import: the module binds its native side eagerly
// (TurboModuleRegistry.getEnforcing) and would throw at app start in a binary
// built before react-native-view-shot was added.
function viewShot(): ViewShot | null {
  try {
    return require("react-native-view-shot") as ViewShot;
  } catch {
    return null;
  }
}

/**
 * The screen the user is looking at, as a PNG whose long side is at most
 * 1600 px — taken BEFORE the report sheet renders, so the sheet is not in it.
 * Null when capture is unavailable, fails, or the screen must not be captured
 * (sign-in, passwords, connection keys, a revealed vault secret).
 */
export async function captureCurrentScreen(): Promise<Attachment | null> {
  if (Platform.OS === "web" || !autoCaptureAllowed(getCurrentRoute(), sensitiveOnScreen())) return null;
  const vs = viewShot();
  if (!vs) return null;
  try {
    // captureScreen takes the whole window on iOS and the decor view (edge to edge) on Android.
    const dims = Dimensions.get(Platform.OS === "android" ? "screen" : "window");
    const size = captureSize(Platform.OS, dims.width, dims.height, PixelRatio.get());
    const uri = await vs.captureScreen({ format: "png", result: "tmpfile", ...(size ?? {}) });
    return { uri, type: "image/png", name: "screenshot.png", source: "screen" };
  } catch {
    return null;
  }
}
