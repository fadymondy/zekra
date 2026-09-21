import Constants from "expo-constants";
import { router } from "expo-router";
import { ChevronRight, Globe2, KeyRound, LockKeyhole, Plug, Server, Share2, Trash2, UserRound } from "lucide-react-native";
import { Linking, Pressable, Share, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { AppText, Header, PrimaryButton, Row, Screen, SecondaryButton, Segmented } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useI18n, type Locale } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { metrics, usePalette, useTheme, type ThemeMode } from "@/theme";

const MCP_URL = "https://mcp.zekra.dev";

function InfoRow({ icon, label, value, action }: { icon: ReactNode; label: string; value: string; action?: ReactNode }) {
  return (
    <View style={styles.infoRow}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="micro">{label.toUpperCase()}</AppText>
        <AppText variant="body" selectable numberOfLines={2}>{value}</AppText>
      </View>
      {action}
    </View>
  );
}

function LinkRow({ icon, label, onPress, tone }: { icon: ReactNode; label: string; onPress: () => void; tone?: "danger" }) {
  const p = usePalette();
  return (
    <Pressable onPress={onPress} style={styles.infoRow} android_ripple={{ color: p.soft }}>
      {icon}
      <AppText variant="rowTitle" color={tone === "danger" ? p.danger : undefined} style={{ flex: 1 }}>{label}</AppText>
      <ChevronRight color={p.muted} size={18} strokeWidth={1.6} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const p = usePalette();
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  const { user, signOut } = useAuth();
  const { current } = useBrains();
  const version = Constants.expoConfig?.version || "development";

  return (
    <Screen scroll header={<Header title={t("settings.title")} eyebrow={t("app.name")} />}>
      <View style={{ height: metrics.gap }} />

      <Row style={{ gap: 14 }}>
        <AppText variant="micro">{t("settings.appearance").toUpperCase()}</AppText>
        <AppText variant="micro">{t("settings.theme").toUpperCase()}</AppText>
        <Segmented<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "system", label: t("settings.themeSystem") },
            { value: "light", label: t("settings.themeLight") },
            { value: "dark", label: t("settings.themeDark") },
          ]}
        />
        <AppText variant="micro">{t("settings.language").toUpperCase()}</AppText>
        <Segmented<Locale>
          value={locale}
          onChange={setLocale}
          options={[{ value: "en", label: "English" }, { value: "ar", label: "العربية" }]}
        />
      </Row>

      <View style={{ height: metrics.gap }} />

      <Row style={{ gap: 0, paddingVertical: 0 }}>
        <InfoRow icon={<UserRound color={p.action} size={20} strokeWidth={1.7} />} label={t("settings.signedInAs")} value={user?.email || user?.name || t("app.name")} />
        <InfoRow icon={<LockKeyhole color={p.gold} size={20} strokeWidth={1.7} />} label={t("settings.activeBrain")} value={current ? `${current.displayName || current.namespace} (${current.role})` : t("settings.none")} />
        <InfoRow icon={<Server color={p.ok} size={20} strokeWidth={1.7} />} label={t("settings.api")} value={API_URL} />
        <InfoRow icon={<Globe2 color={p.muted} size={20} strokeWidth={1.7} />} label={t("settings.version")} value={version} />
      </Row>

      <View style={{ height: metrics.gap }} />

      <Row style={{ gap: 0, paddingVertical: 0 }}>
        <LinkRow icon={<UserRound color={p.action} size={20} strokeWidth={1.7} />} label={t("account.profile")} onPress={() => router.push("/account/profile")} />
        <LinkRow icon={<KeyRound color={p.gold} size={20} strokeWidth={1.7} />} label={t("account.password")} onPress={() => router.push("/account/password")} />
        <LinkRow icon={<Trash2 color={p.danger} size={20} strokeWidth={1.7} />} label={t("account.delete")} tone="danger" onPress={() => router.push("/account/delete")} />
      </Row>

      <View style={{ height: metrics.gap }} />

      <Row style={{ gap: 0, paddingVertical: 0 }}>
        <View style={styles.infoRow}>
          <Plug color={p.action} size={20} strokeWidth={1.7} />
          <AppText variant="body" style={{ flex: 1 }}>{t("settings.mcpBody")}</AppText>
        </View>
        <InfoRow
          icon={<Server color={p.muted} size={20} strokeWidth={1.7} />}
          label={t("settings.mcpUrl")}
          value={MCP_URL}
          action={
            <Pressable onPress={() => void Share.share({ message: MCP_URL }).catch(() => {})} style={[styles.share, { borderColor: p.line, backgroundColor: p.soft }]}>
              <Share2 color={p.muted} size={16} strokeWidth={1.7} />
            </Pressable>
          }
        />
        <InfoRow icon={<LockKeyhole color={p.muted} size={20} strokeWidth={1.7} />} label={t("settings.mcpAuth")} value={t("settings.mcpAuthValue")} />
      </Row>

      <View style={{ height: metrics.gap }} />

      <Row style={{ gap: 0, paddingVertical: 0 }}>
        <LinkRow icon={<Globe2 color={p.muted} size={20} strokeWidth={1.7} />} label={t("legal.privacy")} onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "privacy" } })} />
        <LinkRow icon={<Globe2 color={p.muted} size={20} strokeWidth={1.7} />} label={t("legal.terms")} onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "terms" } })} />
        <LinkRow icon={<Globe2 color={p.muted} size={20} strokeWidth={1.7} />} label={t("legal.support")} onPress={() => router.push({ pathname: "/legal/[doc]", params: { doc: "support" } })} />
      </Row>

      <View style={{ height: metrics.gap }} />

      <View style={{ paddingHorizontal: metrics.padX, gap: 12 }}>
        <SecondaryButton label={t("settings.openConsole")} onPress={() => void Linking.openURL(API_URL)} />
        <PrimaryButton label={t("auth.signOut")} onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  infoRow: { minHeight: 62, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  share: { width: 34, height: 34, borderWidth: 1, borderRadius: metrics.radius.chip, alignItems: "center", justifyContent: "center" },
});
