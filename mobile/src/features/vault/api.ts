import { request } from "@/lib/api";

// Vault endpoints, typed to what plugins/brain/internal/brain/handlers.go
// (SecretsList / SecretPut / SecretReveal / SecretDelete) actually returns.
// These replace zekraApi.secrets/putSecret/deleteSecret in src/lib/api.ts,
// whose response types do not match the server.

/** SecretMeta in secrets.go — the listing view, never carries a value. */
export type SecretMeta = {
  namespace: string;
  name: string;
  /** Masked preview such as "sk-…mnop", or "••••" for short values. */
  hint: string;
  /** "" when unset; the server defaults new secrets to "generic". */
  kind: string;
  /** Where an auto-captured secret came from ("console" for manual ones). */
  sourceRef?: string;
  createdBy?: string;
  /** RFC3339, UTC. */
  createdAt: string;
  updatedAt: string;
};

export type SecretStored = { namespace: string; name: string; stored: true };
export type SecretRevealed = { namespace: string; name: string; value: string };
export type SecretDeleted = { namespace: string; name: string; deleted: boolean };

const q = (namespace: string) => `?namespace=${encodeURIComponent(namespace)}`;

export const vaultApi = {
  /** GET /api/brain/secrets — read access. */
  list: (token: string, namespace: string) =>
    request<{ secrets: SecretMeta[] }>(`/api/brain/secrets${q(namespace)}`, { token }),
  /** POST /api/brain/secrets — write access; the same name overwrites. */
  put: (token: string, body: { namespace: string; name: string; value: string; kind?: string }) =>
    request<SecretStored>("/api/brain/secrets", { token, json: body }),
  /** POST /api/brain/secrets/reveal — requires WRITE access (401/403 otherwise).
   *  The value must stay in component state: never cache or log it. */
  reveal: (token: string, namespace: string, name: string) =>
    request<SecretRevealed>("/api/brain/secrets/reveal", { token, json: { namespace, name } }),
  /** POST /api/brain/secrets/delete — write access. */
  remove: (token: string, namespace: string, name: string) =>
    request<SecretDeleted>("/api/brain/secrets/delete", { token, json: { namespace, name } }),
};

export const vaultKey = (token: string | null | undefined, namespace: string) => ["vault", token, namespace] as const;
