import { useMemo } from "react";
import type { ImageSourcePropType } from "react-native";

import { API_URL } from "@/lib/api";
import { useAuth } from "@/providers/auth";

/** Absolute URL for an API-relative path (brain avatars, note images). */
export function apiUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

/** An Image source for an auth-gated API path: brain avatars and uploaded note
 *  images are served behind the caller's session, so the bearer rides along. */
export function useAuthedSource(path?: string | null): ImageSourcePropType | undefined {
  const { token } = useAuth();
  return useMemo(() => {
    if (!path) return undefined;
    const uri = apiUrl(path);
    return token && uri.startsWith(API_URL) ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
  }, [path, token]);
}
