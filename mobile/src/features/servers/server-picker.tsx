import { Check, Cloud, Server } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { BottomSheet, ErrorLine, toast } from "@/components/kit";
import { AppText, Field, PrimaryButton } from "@/components/ui";
import { SettingsItem } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { ALLOW_LOCAL_HTTP, checkServer, useServer, type ServerCheck } from "@/lib/server";
import { CLOUD_URL, isCloud, serverLabel } from "@/lib/server-core";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

type Failure = Extract<ServerCheck, { ok: false }>["reason"];

/** zekra://connect?server=… — opens this app (or another Zekra app) on `base`. */
export function connectLink(base: string): string {
  return `zekra://connect?server=${encodeURIComponent(base)}`;
}

/*
Pick the server: Zekra Cloud, or a self-hosted Zekra by its address. The
address is normalised (https unless a development build points at a local
address) and must answer GET /api/health as Zekra before the app switches to
it; nothing is sent to it before that, and never the current server's token.
*/
export function ServerPicker({ onConnected }: { onConnected?: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const { base } = useServer();
  const { switchServer } = useAuth();
  const [custom, setCustom] = useState(!isCloud(base));
  const [input, setInput] = useState(isCloud(base) ? "" : serverLabel(base));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function use(url: string) {
    await switchServer(url);
    toast(t("server.switched", { server: serverLabel(url) }), "ok");
    onConnected?.();
  }

  async function connect() {
    setBusy(true);
    setFailure(null);
    try {
      const r = await checkServer(input);
      if (!r.ok) return setFailure(r.reason);
      await use(r.url);
    } finally {
      setBusy(false);
    }
  }

  const tick = (on: boolean) => (on ? <Check size={18} color={p.action} strokeWidth={2} /> : <View />);
  return (
    <View style={{ gap: 12 }}>
      <View>
        <SettingsItem
          Icon={Cloud}
          tone={!custom ? "accent" : undefined}
          label={t("server.cloud")}
          detail={t("server.cloudDetail")}
          trailing={tick(!custom)}
          onPress={() => {
            setCustom(false);
            setFailure(null);
            if (!isCloud(base)) void use(CLOUD_URL);
          }}
        />
        <SettingsItem
          last
          Icon={Server}
          tone={custom ? "accent" : undefined}
          label={t("server.custom")}
          detail={t("server.customDetail")}
          trailing={tick(custom)}
          onPress={() => setCustom(true)}
        />
      </View>
      {custom ? (
        <View style={{ gap: 12 }}>
          <Field
            label={t("server.urlLabel")}
            hint={ALLOW_LOCAL_HTTP ? t("server.urlHintDev") : t("server.urlHint")}
            value={input}
            onChangeText={(v) => {
              setInput(v);
              setFailure(null);
            }}
            placeholder="zekra.example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            textContentType="URL"
            returnKeyType="go"
            onSubmitEditing={() => void connect()}
            ltr
          />
          {failure ? <ErrorLine text={t(`server.err.${failure}`)} /> : null}
          <PrimaryButton label={busy ? t("server.checking") : t("server.connect")} loading={busy} disabled={!input.trim()} onPress={() => void connect()} />
        </View>
      ) : null}
    </View>
  );
}

/** Sign-in's "Server: app.zekra.dev · Change", opening the picker in a sheet. */
export function ServerLine() {
  const p = usePalette();
  const { t } = useI18n();
  const { base } = useServer();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t("server.label")}: ${serverLabel(base)}. ${t("server.change")}`}
        onPress={() => setOpen(true)}
        style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, flexWrap: "wrap" }}
      >
        {isCloud(base) ? <Cloud size={16} color={p.muted} strokeWidth={1.7} /> : <Server size={16} color={p.muted} strokeWidth={1.7} />}
        <AppText style={{ fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: p.muted }}>{t("server.label")}</AppText>
        <AppText style={{ fontFamily: fonts.mono, fontSize: 13, lineHeight: 21, color: p.ink, writingDirection: "ltr" }}>{serverLabel(base)}</AppText>
        <AppText style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, color: p.action }}>{t("server.change")}</AppText>
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("server.title")} subtitle={t("server.intro")}>
        <View style={{ paddingHorizontal: metrics.padX, paddingBottom: 12 }}>
          <ServerPicker onConnected={() => setOpen(false)} />
        </View>
      </BottomSheet>
    </>
  );
}
