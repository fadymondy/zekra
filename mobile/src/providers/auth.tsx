import { unregisterPush } from "@/features/push/push";
import { appleCredential } from "@/features/social/apple";
import { browserGrant } from "@/features/social/browser-flow";
import { googleIdToken } from "@/features/social/google";
import type { SocialProvider, SocialVia } from "@/features/social/social-core";
import { sessionKey } from "@/lib/server-core";
import { activateServer, apiBase, bindToken, DEFAULT_SERVER, forgetServer, loadServer, unbindToken } from "@/lib/server";
import { getStored, removeStored, setStored } from "@/lib/storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";

import { ApiError, authApi, type AuthAnswer, type User } from "@/lib/api";

/** The provider's sheet, then the API — or null when the user closed the sheet. */
async function socialAnswer(provider: SocialProvider, via: SocialVia): Promise<AuthAnswer | null> {
  switch (provider) {
    case "google": {
      if (via.google === "native") {
        const idToken = await googleIdToken();
        return idToken ? authApi.google(idToken) : null;
      }
      const grant = await browserGrant("google");
      return grant ? authApi.socialExchange("google", grant.code, grant.verifier) : null;
    }
    case "apple": {
      if (via.apple === "browser") {
        const grant = await browserGrant("apple");
        return grant ? authApi.socialExchange("apple", grant.code, grant.verifier) : null;
      }
      const cred = await appleCredential();
      if (!cred) return null;
      return authApi.apple({
        identity_token: cred.identityToken,
        nonce: cred.nonce,
        full_name: cred.fullName || undefined,
        authorization_code: cred.authorizationCode ?? undefined,
      });
    }
    case "github": {
      const grant = await browserGrant("github");
      return grant ? authApi.socialExchange("github", grant.code, grant.verifier) : null;
    }
  }
}

/** Before servers could be chosen there was one session, for the default server. */
const LEGACY_SESSION_KEY = "zekra.mobile.session.v1";

type AuthContextValue = {
  ready: boolean;
  token: string | null;
  user: User | null;
  signIn(email: string, password: string): Promise<AuthAnswer>;
  register(email: string, password: string, name: string): Promise<AuthAnswer>;
  finishChallenge(challenge: string, answer: { code?: string; recovery_code?: string }): Promise<AuthAnswer>;
  /** Google / Apple / GitHub. Resolves null when the user closed the provider's
   *  sheet (not an error); throws ApiError or SocialSignInError otherwise —
   *  including a 401 2fa_required challenge, finished with finishChallenge like a
   *  password sign-in. `via` picks Google's browser flow (default) or its
   *  native SDK, and Apple's sheet (default) or its browser flow (Android) —
   *  useSocialProviders decides. */
  signInWith(provider: SocialProvider, via?: SocialVia): Promise<AuthAnswer | null>;
  /** Adopt a session obtained elsewhere (a browser sign-in finished after a cold start). */
  acceptSession(answer: AuthAnswer): Promise<AuthAnswer>;
  /** Sign out of the active server (sessions on other servers are kept). */
  signOut(): Promise<void>;
  /** Connect to another server (normalised and checked by the caller) and
   *  pick up the session this device already has there, if any. */
  switchServer(base: string): Promise<void>;
  /** Forget a saved server that is not the active one, and its session here. */
  removeServer(base: string): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/*
One session per server, each under its own secure-store key (sessionKey), so
switching servers never carries a token across: the token is bound to the
server that issued it (server.ts bindToken) and only ever sent there.
*/
async function saveSession(base: string, answer: AuthAnswer | null) {
  if (!answer) return removeStored(sessionKey(base));
  await setStored(sessionKey(base), JSON.stringify({ token: answer.token, user: answer.user }));
}

async function readSession(base: string): Promise<AuthAnswer | null> {
  let raw = await getStored(sessionKey(base));
  if (!raw && base === DEFAULT_SERVER) {
    // The session an older version kept, before servers could be chosen.
    raw = await getStored(LEGACY_SESSION_KEY);
    if (raw) {
      await setStored(sessionKey(base), raw);
      await removeStored(LEGACY_SESSION_KEY);
    }
  }
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as AuthAnswer;
    return saved?.token ? saved : null;
  } catch {
    await saveSession(base, null);
    return null;
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  // Bumped on every server switch so a slow restore for the previous server
  // cannot land after the switch.
  const generation = useRef(0);

  /** Adopt the saved session for `base` (if any) and check it is still valid. */
  const restore = useCallback(async (base: string) => {
    const gen = ++generation.current;
    const current = () => gen === generation.current;
    try {
      const saved = await readSession(base);
      if (!current() || !saved) return;
      bindToken(saved.token, base);
      setToken(saved.token);
      setUser(saved.user ?? null);
      try {
        const me = await authApi.me(saved.token);
        if (!current()) return;
        const wrapped = me as { user?: User };
        const resolved = wrapped.user ?? (("id" in me && "email" in me) ? me as User : undefined);
        if (resolved) setUser(resolved);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await saveSession(base, null);
          if (current()) { setToken(null); setUser(null); }
        }
      }
    } finally {
      if (current()) setReady(true);
    }
  }, []);

  useEffect(() => {
    void loadServer().then(restore);
    return () => { generation.current++; };
  }, [restore]);

  const accept = useCallback(async (answer: AuthAnswer) => {
    const base = apiBase();
    bindToken(answer.token, base);
    setToken(answer.token);
    setUser(answer.user);
    await saveSession(base, answer);
    return answer;
  }, []);

  const signIn = useCallback((email: string, password: string) => authApi.login(email.trim(), password).then(accept), [accept]);
  const register = useCallback(
    (email: string, password: string, name: string) => authApi.register(email.trim(), password, name.trim()).then(accept),
    [accept],
  );
  const finishChallenge = useCallback(
    (challenge: string, answer: { code?: string; recovery_code?: string }) => authApi.challenge(challenge, answer).then(accept),
    [accept],
  );
  const signInWith = useCallback(
    async (provider: SocialProvider, via: SocialVia = { google: "browser", apple: "native" }) => {
      const answer = await socialAnswer(provider, via);
      return answer ? accept(answer) : null;
    },
    [accept],
  );
  const signOut = useCallback(async () => {
    const current = token;
    // Detach this device from the account while the session can still
    // authenticate the call, so a signed-out phone stops receiving pushes.
    if (current) await unregisterPush(current);
    setToken(null);
    setUser(null);
    await saveSession(apiBase(), null);
    if (current) {
      await authApi.logout(current).catch(() => undefined);
      unbindToken(current);
    }
  }, [token]);

  const switchServer = useCallback(async (base: string) => {
    if (base === apiBase()) return;
    // Drop the current session from memory before the base changes, so
    // nothing in flight pairs the old token with the new server. It stays
    // saved for that server, ready when the user switches back.
    generation.current++;
    setToken(null);
    setUser(null);
    setReady(false);
    await activateServer(base);
    await restore(base);
  }, [restore]);

  const removeServer = useCallback(async (base: string) => {
    if (base === apiBase()) return;
    await saveSession(base, null);
    await forgetServer(base);
  }, []);

  const value = useMemo(
    () => ({ ready, token, user, signIn, register, finishChallenge, signInWith, acceptSession: accept, signOut, switchServer, removeServer }),
    [ready, token, user, signIn, register, finishChallenge, signInWith, accept, signOut, switchServer, removeServer],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be inside AuthProvider");
  return value;
}
