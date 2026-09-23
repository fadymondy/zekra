import { useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { AppText, SecondaryButton } from "@/components/ui";
import { authApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette, useTheme } from "@/theme";

import { appleAvailable, loadApple } from "./apple";
import { browserFlowAvailable } from "./browser-flow";
import { googleSdkAvailable } from "./google";
import { GitHubMark, GoogleMark } from "./provider-marks";
import { isFresh, planSocial, serverSupport, supportFromMethods, type ServerSupport, type SocialPlan, type SocialProvider } from "./social-core";

export const PROVIDER_NAME: Record<SocialProvider, string> = { apple: "Apple", google: "Google", github: "GitHub" };

// The last plan and when it was made, shared by every mount (sign-in screen
// re-renders, back-and-forth navigation) so the providers call runs at most
// once per PROVIDERS_TTL_MS. Failures are not cached: the next mount retries.
let cached: { at: number; plan: SocialPlan } | null = null;
let inflight: Promise<SocialPlan | null> | null = null;

/** What the server supports: GET /api/auth/providers, else (older server) the methods list. null = unreachable. */
async function loadServer(): Promise<ServerSupport | null> {
  const payload = await authApi.providers().catch(() => undefined);
  const direct = serverSupport(payload);
  if (direct) return direct;
  const methods = await authApi.methods().catch(() => undefined);
  return methods === undefined ? null : supportFromMethods(methods);
}

async function loadPlan(): Promise<SocialPlan | null> {
  const server = await loadServer();
  if (!server) return null;
  const plan = planSocial(server, {
    browser: browserFlowAvailable(),
    googleSdk: googleSdkAvailable(),
    // Only ask the device when the server could use it.
    apple: server.apple && (await appleAvailable()),
  });
  cached = { at: Date.now(), plan };
  return plan;
}

/**
 * Which provider buttons to show, and how Google signs in. `null` while still
 * finding out — the caller shows the password form right away and the buttons
 * appear when this resolves; it never blocks the screen.
 */
export function useSocialProviders(): SocialPlan | null {
  const [plan, setPlan] = useState<SocialPlan | null>(() => (cached && isFresh(cached.at, Date.now()) ? cached.plan : null));
  useEffect(() => {
    if (cached && isFresh(cached.at, Date.now())) {
      setPlan(cached.plan);
      return;
    }
    let alive = true;
    inflight ??= loadPlan().finally(() => {
      inflight = null;
    });
    void inflight.then((next) => {
      if (alive && next) setPlan(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return plan;
}

/** "or", then Continue with Apple / Google / GitHub — only the ones that work here. */
export function SocialButtons({ providers, running, disabled, onPress }: {
  providers: SocialProvider[];
  /** The provider whose sign-in is in flight. */
  running: SocialProvider | null;
  disabled?: boolean;
  onPress: (provider: SocialProvider) => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const { scheme } = useTheme();
  if (providers.length === 0) return null;
  const off = disabled || running !== null;
  const Apple = Platform.OS === "ios" ? loadApple() : null;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: p.line }} />
        <AppText style={{ fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: p.muted }}>{t("social.or")}</AppText>
        <View style={{ flex: 1, height: 1, backgroundColor: p.line }} />
      </View>
      {providers.map((provider) => {
        if (provider === "apple") {
          if (!Apple) return null;
          // Apple's own button (HIG, App Review 4.8): white on the dark theme,
          // black on the light one. iOS localises its label.
          return (
            <View
              key={provider}
              accessibilityLabel={t("social.apple")}
              pointerEvents={off ? "none" : "auto"}
              style={{ opacity: off && running !== "apple" ? 0.45 : 1 }}
            >
              <Apple.AppleAuthenticationButton
                buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={scheme === "dark" ? Apple.AppleAuthenticationButtonStyle.WHITE : Apple.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={metrics.radius.control}
                style={{ width: "100%", height: metrics.button }}
                onPress={() => onPress("apple")}
              />
            </View>
          );
        }
        return (
          <SecondaryButton
            key={provider}
            label={t(provider === "google" ? "social.google" : "social.github")}
            icon={provider === "google" ? <GoogleMark /> : <GitHubMark color={p.ink} />}
            loading={running === provider}
            disabled={off && running !== provider}
            onPress={() => onPress(provider)}
          />
        );
      })}
    </View>
  );
}
