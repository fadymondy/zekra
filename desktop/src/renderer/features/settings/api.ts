import { request } from "../../lib/api";

/*
The account area's API (internal/account/area_api.go) — the same calls as
mobile's zekraApi.profile/updateProfile/deleteAccount/deleteState/cancelDelete.
Deletion is password-confirmed and SCHEDULED (cancellable until it runs); a
session alone cannot delete an account.
*/
export type AccountProfile = { name?: string; email?: string; avatar?: string; timezone?: string };
export type DeleteState = {
  status: "none" | "scheduled" | "cancelled" | "purged";
  scheduled_for?: string;
  requested_at?: string;
  cancelled_at?: string;
};

export const accountApi = {
  profile: (token: string) => request<AccountProfile>("/api/me/account/profile", { token }),
  updateProfile: (token: string, body: { name?: string; avatar?: string; timezone?: string }) =>
    request<AccountProfile>("/api/me/account/profile", { method: "PUT", token, json: body }),
  deleteState: (token: string) => request<DeleteState>("/api/me/delete", { token }),
  deleteAccount: (token: string, password: string) => request<DeleteState>("/api/me/delete", { token, csrf: true, json: { password } }),
  cancelDelete: (token: string) => request<DeleteState>("/api/me/delete/cancel", { token, csrf: true, json: {} }),
};

/** Zekra's remote MCP endpoint (the same constant mobile's Connect screen shows). */
export const MCP_URL = "https://mcp.zekra.dev";

/** Marketing-site legal pages, per locale (mobile app/(account)/legal/[doc].tsx). */
export const SITE = "https://zekra.dev";
export const SUPPORT_EMAIL = "info@3x1.io";
export function legalUrl(doc: "privacy" | "terms" | "support", locale: string): string {
  const path = doc === "support" ? "/support" : `/legal/${doc}`;
  return `${SITE}/${locale === "ar" ? "ar" : "en"}${path}`;
}
