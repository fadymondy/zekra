import { router, useLocalSearchParams } from "expo-router";
import { Server } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorLine, toast } from "@/components/kit";
import { AppText, PrimaryButton, SecondaryButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { ALLOW_LOCAL_HTTP, checkServer, useServer, type ServerCheck } from "@/lib/server";
import { connectTarget, serverLabel } from "@/lib/server-core";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

/*
zekra://connect?server=https%3A%2F%2Fzekra.example.com — a QR code, another
device or the web console asking this app to use a server. It is never
followed silently: the user sees the address and confirms, the server must
answer as Zekra, and then they sign in on it here. Only `server` is read; a
link cannot carry a session (any `token` in it is ignored).
*/
export default function ConnectScreen() {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ server?: string }>();
  const { base } = useServer();
  const { switchServer } = useAuth();
  const target = connectTarget(params, { allowLocalHttp: ALLOW_LOCAL_HTTP });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<ServerCheck, { ok: false }>["reason"] | null>(null);

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));

  async function connect(url: string) {
    setBusy(true);
    setFailure(null);
    try {
      const r = await checkServer(url);
      if (!r.ok) return setFailure(r.reason);
      await switchServer(r.url);
      toast(t("server.switched", { server: serverLabel(r.url) }), "ok");
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  const url = "url" in target ? target.url : null;
  return (
    <View style={[styles.page, { backgroundColor: p.bg, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24, direction: isRtl ? "rtl" : "ltr" }]}>
      <View style={styles.column}>
        <Server size={34} color={p.action} strokeWidth={1.5} style={{ alignSelf: "center" }} />
        <AppText style={{ fontFamily: fonts.semibold, fontSize: 24, lineHeight: 32, color: p.ink, textAlign: "center" }}>{t("server.linkTitle")}</AppText>
        {url ? (
          <>
            <AppText style={{ fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: p.muted, textAlign: "center" }}>{t("server.linkBody")}</AppText>
            <AppText selectable style={{ fontFamily: fonts.mono, fontSize: 15, lineHeight: 22, color: p.ink, textAlign: "center", writingDirection: "ltr" }}>
              {serverLabel(url)}
            </AppText>
            {url === base ? (
              <AppText style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: p.muted, textAlign: "center" }}>{t("server.linkCurrent")}</AppText>
            ) : (
              <AppText style={{ fontFamily: fonts.light, fontSize: 14, lineHeight: 21, color: p.muted, textAlign: "center" }}>{t("server.linkNote")}</AppText>
            )}
            {failure ? <ErrorLine text={t(`server.err.${failure}`)} /> : null}
            {url !== base ? <PrimaryButton label={t("server.linkConfirm")} loading={busy} onPress={() => void connect(url)} /> : null}
          </>
        ) : (
          <ErrorLine text={"error" in target && target.error === "insecure" ? t("server.err.insecure") : t("server.linkBad")} />
        )}
        <SecondaryButton label={t("server.linkCancel")} onPress={leave} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 24, justifyContent: "center" },
  column: { width: "100%", maxWidth: 400, alignSelf: "center", gap: 14 },
});
