import * as Clipboard from "expo-clipboard";
import { Linking, Share } from "react-native";

import { exportFileName } from "./presentations-core";

/*
Device-side actions for links and exported files.

expo-file-system and expo-sharing are native modules that only exist in a
build made after they were added, so they are loaded on first use rather than
at import: an older dev client then falls back to opening the file in the
browser instead of failing to start.
*/

export async function copyText(text: string) {
  await Clipboard.setStringAsync(text);
}

/** The OS share sheet with a URL (iOS attaches it as a link). */
export async function shareLink(url: string, title?: string) {
  await Share.share({ message: url, url, title });
}

export async function openInBrowser(url: string) {
  await Linking.openURL(url);
}

/**
 * Download an export to the cache and hand it to the share sheet (Save to
 * Files, Mail, AirDrop…). Returns false when the native modules are missing
 * or sharing is unavailable, after opening the URL in the browser instead.
 */
export async function downloadAndShare(url: string, title: string, locale: string, format: string): Promise<boolean> {
  let fs: typeof import("expo-file-system");
  let sharing: typeof import("expo-sharing");
  try {
    fs = await import("expo-file-system");
    sharing = await import("expo-sharing");
    if (!(await sharing.isAvailableAsync())) throw new Error("sharing unavailable");
  } catch {
    await openInBrowser(url);
    return false;
  }
  const target = new fs.File(fs.Paths.cache, exportFileName(title, locale, format));
  const file = await fs.File.downloadFileAsync(url, target, { idempotent: true });
  await sharing.shareAsync(file.uri, {
    mimeType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    UTI: format === "pdf" ? "com.adobe.pdf" : "org.openxmlformats.wordprocessingml.document",
    dialogTitle: title,
  });
  return true;
}
