import { useMemo } from "react";
import type { ImageSourcePropType } from "react-native";

import { apiUrl, authHeader, useServer } from "@/lib/server";
import { useAuth } from "@/providers/auth";

/** Absolute URL for an API-relative path (brain avatars, note images). */
export { apiUrl } from "@/lib/server";

/** An Image source for an auth-gated API path: brain avatars and uploaded note
 *  images are served behind the caller's session, so the bearer rides along. */
export function useAuthedSource(path?: string | null): ImageSourcePropType | undefined {
  const { token } = useAuth();
  // A relative path resolves against the active server.
  const { base } = useServer();
  return useMemo(() => {
    if (!path || !base) return undefined;
    const uri = apiUrl(path);
    const headers = authHeader(token, uri);
    return headers.Authorization ? { uri, headers } : { uri };
  }, [path, token, base]);
}
