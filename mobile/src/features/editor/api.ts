import { File, Paths } from "expo-file-system";

import { ApiError, uploadNoteImage, zekraApi, type Note, type NotePatch } from "@/lib/api";

/*
Note API calls the editor makes, on top of the read-only src/lib/api.ts.
*/

export type NoteSaveResult =
  | { ok: true; note: Note }
  | { ok: false; conflict: boolean; error: string; status: number };

/** PUT with the version the edit was based on; a 409 is reported, not thrown. */
export async function saveNote(token: string, base: Note, patch: NotePatch): Promise<NoteSaveResult> {
  try {
    return { ok: true, note: await zekraApi.updateNote(token, base, patch) };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 0;
    return { ok: false, conflict: status === 409, error: e instanceof Error ? e.message : String(e), status };
  }
}

/** Overwrite: re-read the server's current version and PUT ours over it. */
export async function overwriteNote(token: string, id: string, patch: NotePatch): Promise<Note> {
  const server = await zekraApi.note(token, id);
  return zekraApi.updateNote(token, server, patch);
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic" };

/**
 * Upload an image the WebView handed over as a data: URL (paste / drop).
 * Written to the cache first so RN's FormData can stream it from disk as a
 * {uri,name,type} descriptor (see uploadNoteImage) instead of holding the
 * base64 in a request body.
 */
export async function uploadDataUrlImage(token: string, namespace: string, dataUrl: string, mime: string, name: string): Promise<string> {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) throw new Error("not an image");
  const type = mime || dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png";
  if (type === "image/svg+xml") throw new Error("SVG images are not supported");
  const file = new File(Paths.cache, `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[type] ?? "png"}`);
  file.create({ overwrite: true });
  file.write(dataUrl.slice(comma + 1), { encoding: "base64" });
  try {
    const { url } = await uploadNoteImage(token, namespace, { uri: file.uri, name: name || `pasted.${EXT[type] ?? "png"}`, type });
    return url;
  } finally {
    try {
      file.delete();
    } catch {
      // Cache files are reclaimed by the OS anyway.
    }
  }
}
