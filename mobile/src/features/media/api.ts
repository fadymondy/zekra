import { ApiError, request } from "@/lib/api";
import { apiBase, authHeader } from "@/lib/server";

import { listQuery } from "./media-core";
import type { Media, MediaKind, MediaList } from "./types";

// Media endpoints (plugins/brain/internal/brain/media.go mountMedia) — the same
// ones the web console's Media section (web/lib/media.ts) and the MCP tools
// media_list / media_get / media_retain use.

const path = (id: string) => `/api/brain/media/${encodeURIComponent(id)}`;

export const mediaApi = {
  /** GET /api/brain/media — a brain's media, newest first; `reader` is false
   *  when the server has no OCR service, so uploads would stay queued. */
  list: (token: string, namespace: string, kind: MediaKind | "all") =>
    request<MediaList>(`/api/brain/media?${listQuery(namespace, kind)}`, { token }),
  /** GET /api/brain/media/{id} — one file with what the reader found. */
  get: (token: string, id: string) => request<Media>(path(id), { token }),
  /** POST /api/brain/media/{id}/reprocess — read it again. */
  reprocess: (token: string, id: string) => request<Media>(`${path(id)}/reprocess`, { token, method: "POST" }),
  /** DELETE /api/brain/media/{id} — the file, its note and the memories made from it. */
  remove: (token: string, id: string) => request<void>(path(id), { token, method: "DELETE" }),
};

/** Absolute URL of the file itself; it needs the bearer (fileHeaders). */
export const mediaFileUrl = (m: Pick<Media, "url">) => `${apiBase()}${m.url}`;
/** Headers for a request to `url` — the bearer only when `url` is on the token's server. */
export const fileHeaders = (token: string | null | undefined, url: string): Record<string, string> => ({
  "X-Agent-Id": "zekra-mobile",
  ...authHeader(token, url),
});

/*
POST /api/brain/media, multipart (namespace, file). Like uploadNoteImage in
src/lib/api.ts this is not routed through request(): RN's FormData takes a
{uri, name, type} descriptor and streams the file from disk, and Content-Type
must be left for fetch to write with its boundary.

The server stores the file, creates its companion note ("media" tag) and
starts reading it: 201 with the new media, or 200 with the one this brain
already has for the same bytes (`duplicate`).
*/
export async function uploadMedia(
  token: string,
  namespace: string,
  file: { uri: string; name: string; type: string },
): Promise<{ media: Media; duplicate: boolean }> {
  const form = new FormData();
  form.append("namespace", namespace);
  form.append("file", file as unknown as Blob);
  let response: Response;
  try {
    const url = `${apiBase()}/api/brain/media`;
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", ...fileHeaders(token, url) },
      body: form,
      credentials: "include",
    });
  } catch (error) {
    throw new ApiError(0, error instanceof Error ? error.message : "Could not reach Zekra");
  }
  const payload = (await response.json().catch(() => undefined)) as
    | (Omit<Partial<Media>, "error"> & { error?: { message?: string; code?: string } | string; message?: string })
    | undefined;
  if (!response.ok || !payload?.id) {
    const err = payload?.error;
    const message = typeof err === "string" ? err : err?.message || payload?.message || `Upload failed (${response.status})`;
    throw new ApiError(response.status, message, typeof err === "object" ? err?.code : undefined, payload);
  }
  return { media: payload as Media, duplicate: response.status === 200 };
}

export const mediaListKey = (token: string | null | undefined, namespace: string) => ["media", token, namespace] as const;
export const mediaKey = (token: string | null | undefined, id: string) => ["media-item", token, id] as const;
