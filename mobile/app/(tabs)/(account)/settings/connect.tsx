import * as Clipboard from "expo-clipboard";
import { Copy, ExternalLink, Plug, ShieldCheck } from "lucide-react-native";
import { Linking, Pressable, View } from "react-native";

import { toast } from "@/components/kit";
import { AppText, Row } from "@/components/ui";
import { SettingsItem, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { useServer } from "@/lib/server";
import { mcpUrlFor, serverLabel } from "@/lib/server-core";
import { fonts, usePalette } from "@/theme";

// Settings → Connect: the MCP endpoint agents use, and the web console — both
// on the server this app is connected to (Settings → Server).
export default function ConnectScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { base } = useServer();
  const MCP_URL = mcpUrlFor(base);
  const copy = async (value: string) => {
    await Clipboard.setStringAsync(value);
    toast(t("settings.copied"), "ok");
  };
  return (
    <SettingsPage section="connect">
      <Row>
        <AppText variant="micro">{t("settings.connect")}</AppText>
        <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: 25, color: p.body }}>{t("settings.mcpBody")}</AppText>
        <View>
          <SettingsItem
            Icon={Plug}
            tone="accent"
            label={t("settings.mcpUrl")}
            detail={MCP_URL}
            mono
            onPress={() => void copy(MCP_URL)}
            trailing={
              <Pressable accessibilityRole="button" accessibilityLabel={t("settings.copy")} hitSlop={10} onPress={() => void copy(MCP_URL)}>
                <Copy size={17} color={p.muted} strokeWidth={1.6} />
              </Pressable>
            }
          />
          <SettingsItem Icon={ShieldCheck} label={t("settings.mcpAuth")} detail={t("settings.mcpAuthValue")} />
          <SettingsItem
            last
            Icon={ExternalLink}
            label={t("settings.openConsole")}
            detail={serverLabel(base)}
            mono
            onPress={() => void Linking.openURL(base)}
          />
        </View>
      </Row>
    </SettingsPage>
  );
}
