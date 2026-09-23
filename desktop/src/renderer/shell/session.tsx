import { createContext, useContext, type ReactNode } from "react";

import type { Brain, User } from "../lib/api";
import type { AppSettings, SettingsPatch } from "../lib/bridge";

/*
Who is signed in, which brains they have, and the local settings — everything
chrome and screens need about the session. Provided by app.tsx.
*/
export type Session = {
  settings: AppSettings;
  /** Persist a settings change (main process store) and update state. */
  patch: (p: SettingsPatch) => Promise<AppSettings>;
  user: User | null;
  token: string | null;
  /** null while loading. */
  brains: Brain[] | null;
  reloadBrains: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Resolved light/dark (theme "system" follows macOS). */
  resolvedTheme: "light" | "dark";
  version: string;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside <SessionProvider>");
  return v;
}

/** Signed-in variant for screens that only render after sign-in. */
export function useAuthed(): Session & { user: User; token: string } {
  const s = useSession();
  if (!s.user || !s.token) throw new Error("useAuthed on a signed-out session");
  return s as Session & { user: User; token: string };
}
