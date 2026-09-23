import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import { toast } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

import { completeBrowserReturn } from "./browser-flow";
import type { BrowserProvider } from "./social-core";

// zekra://auth/github and zekra://auth/google — where the system browser sends
// the user back after signing in (browser-flow.ts). The code goes to the
// sign-in that is waiting in this process, or, if the OS closed the app while
// the user was in the browser, is redeemed here with the stored PKCE verifier.
// A link with no pending sign-in of ours is ignored (its code is useless
// without the verifier).
export function AuthSessionReturn({ provider }: { provider: BrowserProvider }) {
  const p = usePalette();
  const { t } = useI18n();
  const { acceptSession } = useAuth();
  const url = Linking.useURL();
  const handled = useRef(false);

  useEffect(() => {
    if (!url || handled.current) return;
    handled.current = true;
    void (async () => {
      const result = await completeBrowserReturn(provider, url);
      if (result.kind === "signedIn") {
        await acceptSession(result.answer);
        router.replace("/brains");
        return;
      }
      if (result.kind === "error") toast(t("social.failed", { provider: provider === "github" ? "GitHub" : "Google" }), "danger");
      // Waiting sign-in (it navigates itself), cancelled, or not ours: step aside.
      if (router.canGoBack()) router.back();
      else router.replace("/");
    })();
  }, [url, provider, acceptSession, t]);

  return <View style={{ flex: 1, backgroundColor: p.bg }} />;
}
