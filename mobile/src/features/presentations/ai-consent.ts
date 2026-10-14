import { getStored, setStored } from "@/lib/storage";

/*
Consent before a presentation goes to an AI model (App Review 5.1.2(i)). The
server names its translator (GET /api/presentations/translate/provider,
plugins/brain/internal/brain/presentations_provider.go); the app asks once per
device and per provider, so a server that switches to another provider asks
again.
*/

import { consentKey, type TranslateProvider } from "./ai-consent-core";

export * from "./ai-consent-core";

export async function hasConsent(p: TranslateProvider): Promise<boolean> {
  return (await getStored(consentKey(p))) === "yes";
}

export async function saveConsent(p: TranslateProvider): Promise<void> {
  await setStored(consentKey(p), "yes");
}
