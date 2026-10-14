import { zekraApi } from "@/lib/api";

import { appleCredential } from "./apple";
import { browserGrant } from "./browser-flow";
import { googleIdToken } from "./google";
import type { SocialProvider, SocialVia } from "./social-core";

// Connect a provider to the signed-in account (the connected-accounts screen):
// the same sheets and browser flows as sign-in, but what the provider proves
// goes to POST /api/me/identities/<provider> with the session's bearer
// (internal/account/identities.go). The API refuses a provider account that is
// already another user's (409 conflict) or a second account of the same
// provider (409 taken).
//
// Resolves false when the user closed the sheet or the browser (not an error);
// throws ApiError or SocialSignInError otherwise.
export async function linkProvider(token: string, provider: SocialProvider, via: SocialVia): Promise<boolean> {
  if (provider === "apple" && via.apple !== "browser") {
    const cred = await appleCredential();
    if (!cred) return false;
    await zekraApi.linkIdentity(token, "apple", {
      identity_token: cred.identityToken,
      nonce: cred.nonce,
      ...(cred.authorizationCode ? { authorization_code: cred.authorizationCode } : {}),
    });
    return true;
  }
  if (provider === "google" && via.google === "native") {
    const idToken = await googleIdToken();
    if (!idToken) return false;
    await zekraApi.linkIdentity(token, "google", { id_token: idToken });
    return true;
  }
  const grant = await browserGrant(provider, { link: true });
  if (!grant) return false;
  await zekraApi.linkIdentity(token, provider, { code: grant.code, code_verifier: grant.verifier });
  return true;
}
