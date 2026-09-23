import type {
  Detail,
  ExportAnswer,
  FromBrainAnswer,
  FromBrainRequest,
  PLocale,
  PresentationPatch,
  ShareCreated,
  Summary,
} from "@mobile/features/presentations/types";
import { listQuery, type ListFilter } from "@mobile/features/presentations/presentations-core";

import { request } from "../../lib/api";

export type * from "@mobile/features/presentations/types";

/*
Wrappers over the brain's presentations REST surface (MH-450), ported from
mobile/src/features/presentations/api.ts — mobile's file imports its own
request(), so it is restated over the desktop client. Reads need read access
to the brain; every write — including share links and export — needs write.
*/

const enc = encodeURIComponent;
const doc = (id: string) => `/api/presentations/${enc(id)}`;

export const presentationsApi = {
  list: (token: string, filter: ListFilter) =>
    request<{ items: Summary[] | null }>(`/api/presentations${listQuery(filter)}`, { token }),
  get: (token: string, id: string) => request<Detail>(doc(id), { token }),
  update: (token: string, id: string, patch: PresentationPatch) =>
    request<Detail>(doc(id), { method: "PATCH", token, json: patch }),
  /** 204 No Content. */
  remove: (token: string, id: string) => request<void>(doc(id), { method: "DELETE", token }),
  /** Translate with the server's model; 503 {error:{code:"no_translator"}} when none is configured. */
  translate: (token: string, id: string, to: PLocale) =>
    request<Detail>(`${doc(id)}/translate`, { token, json: { to } }),
  fromBrain: (token: string, body: FromBrainRequest) =>
    request<FromBrainAnswer>("/api/presentations/from-brain", { token, json: body }),
  share: (token: string, id: string, body: { label?: string; locale?: PLocale; expires_in_days?: number }) =>
    request<ShareCreated>(`${doc(id)}/share`, { token, json: body }),
  /** Revokes the link and issues a new one with the same label, locale, expiry and domain. */
  reissue: (token: string, id: string, shareId: string) =>
    request<ShareCreated>(`${doc(id)}/shares/${enc(shareId)}/reissue`, { token, json: {} }),
  revoke: (token: string, id: string, shareId: string) =>
    request<{ revoked: number }>(`${doc(id)}/shares/${enc(shareId)}`, { method: "DELETE", token }),
  revokeAll: (token: string, id: string) =>
    request<{ revoked: number }>(`${doc(id)}/shares`, { method: "DELETE", token }),
  /** Download URLs through an existing copyable link for the locale, or a new 7-day "export" link. Not for pages. */
  export: (token: string, id: string, locale: PLocale) =>
    request<ExportAnswer>(`${doc(id)}/export`, { token, json: { locale } }),
};
