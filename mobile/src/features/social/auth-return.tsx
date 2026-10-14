import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { AppText, PrimaryButton, SecondaryButton } from "@/components/ui";
import { breadcrumb, reportError } from "@/lib/crash";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

import { pickReturnUrl, RETURN_WATCHDOG_MS, returnStep, type ReturnParams } from "./auth-return-core";
import { cancelBrowserSignIn, completeBrowserReturn } from "./browser-flow";
import { PROVIDER_NAME, socialErrorKey, type BrowserProvider } from "./social-core";

type Phase = { kind: "working" } | { kind: "failed"; message: string };

// zekra://auth/github, zekra://auth/google and zekra://auth/apple — where the system browser sends
// the user back after signing in (browser-flow.ts). The code goes to the
// sign-in that is waiting in this process, or, if the OS closed the app while
// the user was in the browser, is redeemed here with the stored PKCE verifier.
// A link with no pending sign-in of ours is ignored (its code is useless
// without the verifier).
//
// The code is read from the ROUTE PARAMS: when the app is already running,
// expo-router consumes the link's url event and navigates here before this
// screen mounts, so a url listener (expo-linking useURL) never sees it — the
// screen used to wait for it forever on a blank ground. The last linking URL
// is only a fallback.
//
// This screen always shows progress, and never waits more than
// RETURN_WATCHDOG_MS before offering Try again.
export function AuthSessionReturn({ provider }: { provider: BrowserProvider }) {
  const p = usePalette();
  const { t } = useI18n();
  const { acceptSession } = useAuth();
  const params = useLocalSearchParams() as ReturnParams;
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  const handled = useRef(false);
  const settled = useRef(false);

  const fail = useCallback(
    (message: string) => {
      if (settled.current) return;
      settled.current = true;
      setPhase({ kind: "failed", message });
    },
    [],
  );

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const url = pickReturnUrl(provider, params, Linking.getLinkingURL());
    breadcrumb(`auth return ${provider} ${url ? "url" : "nourl"}`);
    if (!url) {
      fail(t("social.returnFailed", { provider: PROVIDER_NAME[provider] }));
      return;
    }
    void (async () => {
      try {
        const result = await completeBrowserReturn(provider, url);
        breadcrumb(`auth return ${provider} ${result.kind}`);
        // Signed in here (cold start): take the session even if the watchdog
        // already showed Try again — a late success still wins.
        if (result.kind === "signedIn") {
          await acceptSession(result.answer);
          settled.current = true;
          router.replace("/brains");
          return;
        }
        if (settled.current) return; // the watchdog already gave up
        const step = returnStep(result.kind);
        if (step === "error") {
          const reason = result.kind === "error" ? result.error.reason : "failed";
          fail(t(socialErrorKey(provider, { reason }), { provider: PROVIDER_NAME[provider] }));
          return;
        }
        settled.current = true;
        // back: the sign-in waiting in this process got the code; it shows its
        // own progress, exchanges it and navigates itself.
        if (step === "back" && router.canGoBack()) router.back();
        else router.replace("/");
      } catch (caught) {
        reportError(caught, `auth return ${provider}`);
        fail(t("social.failed", { provider: PROVIDER_NAME[provider] }));
      }
    })();
  }, [provider, params, acceptSession, t, fail]);

  // Watchdog: whatever happens above, the user is never left on this screen.
  useEffect(() => {
    const timer = setTimeout(() => fail(t("social.returnTimeout")), RETURN_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [fail, t]);

  const tryAgain = () => {
    cancelBrowserSignIn();
    router.replace("/sign-in");
  };
  const back = () => {
    cancelBrowserSignIn();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 14 }}>
      {phase.kind === "working" ? (
        <>
          <ActivityIndicator size="large" color={p.muted} accessibilityLabel={t("social.signingIn")} />
          <AppText style={{ fontFamily: fonts.medium, fontSize: 16, lineHeight: 26, color: p.ink, textAlign: "center" }}>
            {t("social.signingIn")}
          </AppText>
        </>
      ) : (
        <>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 28, color: p.ink, textAlign: "center" }}>
            {t("social.returnTitle")}
          </AppText>
          <AppText style={{ fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: p.muted, textAlign: "center", maxWidth: 320 }}>
            {phase.message}
          </AppText>
          <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8 }}>
            <PrimaryButton label={t("social.tryAgain")} onPress={tryAgain} />
            <SecondaryButton label={t("social.back")} onPress={back} />
          </View>
        </>
      )}
    </View>
  );
}
