import * as ImagePicker from "expo-image-picker";

import { DOCUMENT_TYPES, uploadPart } from "./media-core";

/*
Getting a file off the phone for the media reader: a photo from the camera
(text to read), photos/videos from the library, or a PDF/audio file from the
Files app. iOS is asked for the "compatible" representation, so a HEIC photo
arrives as JPEG — the server reads PNG, JPEG, WebP and BMP.

The Files picker is expo-file-system's File.pickFileAsync, loaded on first use
like presentations/files.ts: an older dev client without it just reports
"unavailable" instead of failing to start.
*/

export type Picked = { uri: string; name: string; type: string };
export type PickResult =
  | { files: Picked[]; rejected: number; tooLarge: number }
  | { error: "permission" | "unavailable" }
  | null;

const TYPE_ERROR = { files: [], rejected: 1, tooLarge: 0 };

function collect(assets: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null }[], fallback: string): PickResult {
  const files: Picked[] = [];
  let rejected = 0;
  let tooLarge = 0;
  for (const a of assets) {
    const r = uploadPart(a, fallback);
    if ("part" in r) files.push(r.part);
    else if (r.error === "size") tooLarge++;
    else rejected++;
  }
  return { files, rejected, tooLarge };
}

function fromPicker(result: ImagePicker.ImagePickerResult, fallback: string): PickResult {
  if (result.canceled || !result.assets?.length) return null;
  return collect(
    result.assets.map((a) => ({ uri: a.uri, name: a.fileName, mimeType: a.mimeType, size: a.fileSize })),
    fallback,
  );
}

/** A photo taken now. */
export async function takePhoto(): Promise<PickResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { error: "permission" };
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
  return fromPicker(result, "photo");
}

/** Photos and videos from the library (several at once). */
export async function pickFromLibrary(): Promise<PickResult> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images", "videos"],
    quality: 0.9,
    allowsMultipleSelection: true,
    selectionLimit: 10,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return fromPicker(result, "media");
}

/** A PDF or an audio file from Files / Drive. */
export async function pickDocument(): Promise<PickResult> {
  let fs: typeof import("expo-file-system");
  try {
    fs = await import("expo-file-system");
    if (typeof fs.File?.pickFileAsync !== "function") throw new Error("no picker");
  } catch {
    return { error: "unavailable" };
  }
  try {
    const picked = await fs.File.pickFileAsync({ mimeTypes: DOCUMENT_TYPES });
    if (picked.canceled || !picked.result) return null;
    const f = picked.result as unknown as { uri: string; name?: string; type?: string; size?: number };
    return collect([{ uri: f.uri, name: f.name, mimeType: f.type, size: f.size }], "file");
  } catch {
    return TYPE_ERROR;
  }
}
