import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, View } from "react-native";

import { ErrorLine, QueryStatus, TextButton, toast } from "@/components/kit";
import { AppText, Row, SecondaryButton } from "@/components/ui";
import { SettingsPage } from "@/features/settings/settings-nav";
import { cancelBrowserSignIn, SocialSignInError } from "@/features/social/browser-flow";
import { linkProvider } from "@/features/social/link";
import { AppleMark, GitHubMark, GoogleMark } from "@/features/social/provider-marks";
import { useSocialProviders } from "@/features/social/social-buttons";
import { PROVIDER_NAME, SOCIAL_PROVIDERS, type SocialProvider } from "@/features/social/social-core";
import { ApiError, zekraApi, type ConnectedIdentity } from "@/lib/api";
import { reportError } from "@/lib/crash";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

// Connected accounts: which Google / Apple / GitHub identities sign in as this
// account (GET /api/me/identities), connect another (the sign-in sheets and
// browser flows in link mode — src/features/social/link.ts), and disconnect
// (DELETE /api/me/identities/<provider>). The API refuses to disconnect the
// last way to sign in (409 last_method; can_unlink is false for it).
// The web console's counterpart is web/components/account/connected-accounts.tsx.
export default function ConnectionsScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const { token } = useAuth();
  const plan = useSocialProviders();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState("");

  const key = ["identities", token];
  const list = useQuery({ queryKey: key, queryFn: () => zekraApi.identities(token!), enabled: !!token });
  const byProvider = new Map<string, ConnectedIdentity>((list.data ?? []).map((i) => [i.provider, i]));
  // Connected ones always show (to disconnect); others when this build + server can connect them.
  const shown = SOCIAL_PROVIDERS.filter((pr) => byProvider.has(pr) || plan?.providers.includes(pr));
  const viaBrowser = (pr: SocialProvider) =>
    pr === "github" || (pr === "google" && plan?.google !== "native") || (pr === "apple" && plan?.apple === "browser");

  const failText = (provider: SocialProvider, e: unknown): string => {
    const name = PROVIDER_NAME[provider];
    if (e instanceof ApiError) {
      if (e.code === "last_method") return t("connections.lastMethod");
      if (e.code === "conflict") return t("connections.conflict", { provider: name });
      if (e.code === "taken") return t("connections.taken", { provider: name });
      if (e.status === 0) return t("social.offline");
      if (e.status === 429) return t("social.tooMany");
      if (e.status === 404) return t("connections.unavailable", { provider: name });
    }
    if (e instanceof SocialSignInError && e.reason === "unavailable") return t("connections.unavailable", { provider: name });
    return t("connections.failed", { provider: name });
  };

  async function connect(provider: SocialProvider) {
    if (!token || busy) return;
    setBusy(provider);
    setError("");
    try {
      const linked = await linkProvider(token, provider, { google: plan?.google ?? "browser", apple: plan?.apple ?? "native" });
      if (linked) {
        toast(t("connections.connectedToast", { provider: PROVIDER_NAME[provider] }), "ok");
        await queryClient.invalidateQueries({ queryKey: key });
      }
    } catch (e) {
      if (!(e instanceof ApiError) && !(e instanceof SocialSignInError)) reportError(e, `connect ${provider}`);
      setError(failText(provider, e));
    } finally {
      setBusy(null);
    }
  }

  function disconnect(provider: SocialProvider) {
    if (!token || busy) return;
    const name = PROVIDER_NAME[provider];
    Alert.alert(t("connections.confirmTitle", { provider: name }), t("connections.confirmBody", { provider: name }), [
      { text: t("social.cancelBrowser"), style: "cancel" },
      {
        text: t("connections.disconnect"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(provider);
            setError("");
            try {
              await zekraApi.unlinkIdentity(token, provider);
              toast(t("connections.disconnectedToast", { provider: name }), "ok");
              await queryClient.invalidateQueries({ queryKey: key });
            } catch (e) {
              setError(failText(provider, e));
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  }

  const when = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en", { dateStyle: "medium" }).format(d);
  };

  const mark = (pr: SocialProvider) =>
    pr === "google" ? <GoogleMark size={20} /> : pr === "apple" ? <AppleMark size={20} color={p.ink} /> : <GitHubMark size={20} color={p.ink} />;

  return (
    <SettingsPage section="connections">
      <Row>
        <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: locale === "ar" ? 30 : 26, color: p.body }}>{t("connections.intro")}</AppText>
      </Row>
      {list.isPending || list.error ? (
        <QueryStatus q={list} lines={3} />
      ) : (
        shown.map((provider) => {
          const id = byProvider.get(provider);
          const name = PROVIDER_NAME[provider];
          const status: string = id
            ? [id.email ? t("connections.connectedAs", { email: id.email }) : t("connections.connected"), id.last_used_at ? t("connections.lastUsed", { date: when(id.last_used_at) }) : ""]
                .filter(Boolean)
                .join(" · ")
            : t("connections.notConnected");
          return (
            <Row key={provider}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: p.field }}>{mark(provider)}</View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontFamily: fonts.medium, fontSize: 16, lineHeight: 23, color: p.ink }}>{name}</AppText>
                  <AppText numberOfLines={2} style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: id ? p.ok : p.muted }}>{status}</AppText>
                </View>
              </View>
              {id ? (
                id.can_unlink ? (
                  <SecondaryButton label={t("connections.disconnect")} loading={busy === provider} disabled={busy !== null && busy !== provider} onPress={() => disconnect(provider)} />
                ) : (
                  <AppText style={{ fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: p.muted }}>{t("connections.lastMethodShort")}</AppText>
                )
              ) : (
                <SecondaryButton
                  label={t("connections.connect")}
                  icon={mark(provider)}
                  loading={busy === provider}
                  disabled={busy !== null && busy !== provider}
                  onPress={() => void connect(provider)}
                />
              )}
              {busy === provider && !id && viaBrowser(provider) ? (
                <View style={{ alignItems: "center", gap: 2 }}>
                  <AppText variant="meta" style={{ textAlign: "center" }}>{t("connections.inBrowser", { provider: name })}</AppText>
                  <TextButton label={t("social.cancelBrowser")} muted onPress={cancelBrowserSignIn} />
                </View>
              ) : null}
            </Row>
          );
        })
      )}
      {error ? (
        <Row>
          <ErrorLine text={error} />
        </Row>
      ) : null}
    </SettingsPage>
  );
}
