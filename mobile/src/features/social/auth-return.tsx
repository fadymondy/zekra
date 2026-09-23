import { router } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { usePalette } from "@/theme";

// zekra://auth/github and zekra://auth/google end an auth session
// (browser-flow.ts), which reads the one-time code from the redirect itself. On
// Android the same link is ALSO delivered to the router as a deep link; without
// a route it would land on "unmatched route". This only gets out of the way —
// the code is never read here, so an outside link to it can do nothing.
export function AuthSessionReturn() {
  const p = usePalette();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);
  return <View style={{ flex: 1, backgroundColor: p.bg }} />;
}
