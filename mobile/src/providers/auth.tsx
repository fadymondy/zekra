import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { ApiError, authApi, type AuthAnswer, type User } from "@/lib/api";

const SESSION_KEY = "zekra.mobile.session.v1";

type AuthContextValue = {
  ready: boolean;
  token: string | null;
  user: User | null;
  signIn(email: string, password: string): Promise<AuthAnswer>;
  finishChallenge(challenge: string, answer: { code?: string; recovery_code?: string }): Promise<AuthAnswer>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function saveSession(answer: AuthAnswer | null) {
  if (!answer) return SecureStore.deleteItemAsync(SESSION_KEY);
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ token: answer.token, user: answer.user }));
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as AuthAnswer;
        if (!saved.token) return;
        setToken(saved.token);
        setUser(saved.user ?? null);
        try {
          const me = await authApi.me(saved.token);
          if (!alive) return;
          const wrapped = me as { user?: User };
          const resolved = wrapped.user ?? (("id" in me && "email" in me) ? me as User : undefined);
          if (resolved) setUser(resolved);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await saveSession(null);
            if (alive) { setToken(null); setUser(null); }
          }
        }
      } catch {
        await saveSession(null);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const accept = useCallback(async (answer: AuthAnswer) => {
    setToken(answer.token);
    setUser(answer.user);
    await saveSession(answer);
    return answer;
  }, []);

  const signIn = useCallback((email: string, password: string) => authApi.login(email.trim(), password).then(accept), [accept]);
  const finishChallenge = useCallback(
    (challenge: string, answer: { code?: string; recovery_code?: string }) => authApi.challenge(challenge, answer).then(accept),
    [accept],
  );
  const signOut = useCallback(async () => {
    const current = token;
    setToken(null);
    setUser(null);
    await saveSession(null);
    if (current) await authApi.logout(current).catch(() => undefined);
  }, [token]);

  const value = useMemo(() => ({ ready, token, user, signIn, finishChallenge, signOut }), [ready, token, user, signIn, finishChallenge, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be inside AuthProvider");
  return value;
}
