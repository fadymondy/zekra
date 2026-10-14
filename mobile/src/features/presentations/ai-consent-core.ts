/*
Pure helpers for the AI consent (ai-consent.ts): no React Native imports, so
`node --test` runs them.
*/

export type TranslateProvider = {
  available: boolean;
  /** "anthropic" | "openai-compatible" | "self-hosted" | "none", or "unknown" when the server could not say. */
  provider: string;
  /** Display name of a third-party provider ("Anthropic (Claude)", a host name). */
  name: string;
  third_party: boolean;
};

export const UNKNOWN_PROVIDER: TranslateProvider = { available: true, provider: "unknown", name: "", third_party: true };

export function consentKey(p: TranslateProvider): string {
  // SecureStore keys allow only [A-Za-z0-9._-].
  const id = `${p.provider}.${p.name}`.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `zekra.aiConsent.translate.${id}`;
}

/** The i18n key of the consent body for this provider. */
export function consentBodyKey(p: TranslateProvider) {
  if (p.provider === "self-hosted") return "presentations.translate.consentSelfHosted" as const;
  if (p.third_party && p.name) return "presentations.translate.consentThirdParty" as const;
  return "presentations.translate.consentUnknown" as const;
}
