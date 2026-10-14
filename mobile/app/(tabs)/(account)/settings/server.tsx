import { router } from "expo-router";
import { Cloud, LogOut, Server, Share2, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, Share, View } from "react-native";

import { Chip } from "@/components/kit";
import { AppText, Row, SecondaryButton, SectionLabel } from "@/components/ui";
import { connectLink, ServerPicker } from "@/features/servers/server-picker";
import { SettingsItem, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { useServer } from "@/lib/server";
import { isCloud, serverLabel, sessionKey } from "@/lib/server-core";
import { getStored } from "@/lib/storage";
import { useAuth } from "@/providers/auth";
import { fonts, usePalette } from "@/theme";

// Settings → Server: the server this app is connected to, the others used on
// this device (each with its own sign-in), adding one, and the link that
// connects another device or app to the same server.
export default function ServerScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { base, servers } = useServer();
  const { token, switchServer, removeServer, signOut } = useAuth();
  const others = servers.filter((s) => s !== base);
  const [signedIn, setSignedIn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    void Promise.all(others.map(async (s) => [s, !!(await getStored(sessionKey(s)))] as const)).then((pairs) => {
      if (alive) setSignedIn(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.join("|"), base]);

  const icon = (s: string) => (isCloud(s) ? Cloud : Server);

  function remove(s: string) {
    Alert.alert(t("server.removeTitle"), t("server.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("server.remove"), style: "destructive", onPress: () => void removeServer(s) },
    ]);
  }

  return (
    <SettingsPage section="server">
      <Row>
        <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: 25, color: p.body }}>{t("server.intro")}</AppText>
        <SettingsItem
          last
          Icon={icon(base)}
          tone="accent"
          label={isCloud(base) ? t("server.cloud") : serverLabel(base)}
          detail={serverLabel(base)}
          mono
          trailing={<Chip label={(token ? t("server.signedIn") : t("server.signedOut")).toUpperCase()} tone={token ? "ok" : "muted"} />}
        />
        {token ? (
          <SecondaryButton
            label={t("server.signOutHere")}
            icon={<LogOut size={17} color={p.ink} strokeWidth={1.6} />}
            onPress={() => void signOut().then(() => router.replace("/sign-in"))}
          />
        ) : null}
      </Row>

      {others.length ? (
        <>
          <SectionLabel>{t("server.saved")}</SectionLabel>
          <Row style={{ paddingVertical: 0 }}>
            <View>
              {others.map((s, i) => (
                <SettingsItem
                  key={s}
                  last={i === others.length - 1}
                  Icon={icon(s)}
                  label={isCloud(s) ? t("server.cloud") : serverLabel(s)}
                  detail={`${serverLabel(s)} · ${signedIn[s] ? t("server.signedIn") : t("server.signedOut")}`}
                  onPress={() => void switchServer(s)}
                  trailing={
                    <Pressable accessibilityRole="button" accessibilityLabel={t("server.remove")} hitSlop={10} onPress={() => remove(s)}>
                      <Trash2 size={17} color={p.muted} strokeWidth={1.6} />
                    </Pressable>
                  }
                />
              ))}
            </View>
          </Row>
        </>
      ) : null}

      <SectionLabel>{t("server.add")}</SectionLabel>
      <Row>
        <ServerPicker />
      </Row>

      <SectionLabel>{t("server.otherClients")}</SectionLabel>
      <Row>
        <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: 25, color: p.body }}>{t("server.otherClientsBody")}</AppText>
        <SecondaryButton
          label={t("server.shareLink")}
          icon={<Share2 size={17} color={p.ink} strokeWidth={1.6} />}
          onPress={() => void Share.share({ message: `${connectLink(base)}\n${base}` })}
        />
      </Row>
    </SettingsPage>
  );
}
