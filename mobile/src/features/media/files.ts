import { Linking } from "react-native";

import { fileHeaders, mediaFileUrl } from "./api";
import { localFileName } from "./media-core";
import type { Media } from "./types";

/*
"Open file": the file needs the bearer, so it is downloaded to the cache with
it and handed to the share sheet (Quick Look / Save to Files / another app).
Loaded on first use like presentations/files.ts — an older dev client without
expo-file-system / expo-sharing gets the browser instead of a failed start.
*/
export async function openMediaFile(token: string, m: Media): Promise<void> {
  let fs: typeof import("expo-file-system");
  let sharing: typeof import("expo-sharing");
  try {
    fs = await import("expo-file-system");
    sharing = await import("expo-sharing");
    if (!(await sharing.isAvailableAsync())) throw new Error("sharing unavailable");
  } catch {
    await Linking.openURL(mediaFileUrl(m));
    return;
  }
  const url = mediaFileUrl(m);
  const target = new fs.File(fs.Paths.cache, localFileName(m));
  const file = await fs.File.downloadFileAsync(url, target, { idempotent: true, headers: fileHeaders(token, url) });
  await sharing.shareAsync(file.uri, { mimeType: m.contentType, dialogTitle: m.name });
}
