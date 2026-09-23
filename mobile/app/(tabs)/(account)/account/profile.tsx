import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Mail, User } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { ErrorLine, QueryStatus, toast } from "@/components/kit";
import { AppText, Field, PrimaryButton, Row } from "@/components/ui";
import { zekraApi } from "@/lib/api";
import { SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

// Account → Profile: display name and timezone (PUT /api/me/account/profile).
// The email is the sign-in identity and shows read-only.
export default function ProfileScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { token, user } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState("");

  const profile = useQuery({ queryKey: ["profile", token], queryFn: () => zekraApi.profile(token!), enabled: !!token });

  useEffect(() => {
    if (!profile.data) return;
    setName(profile.data.name ?? "");
    setTimezone(profile.data.timezone ?? "");
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => zekraApi.updateProfile(token!, { name: name.trim(), timezone: timezone.trim() }),
    onSuccess: () => {
      setError("");
      toast(t("account.saved"), "ok");
      void client.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e) => setError(e instanceof Error && e.message ? e.message : t("account.saveFailed")),
  });

  const icon = (I: typeof Mail) => <I size={17} color={p.muted} strokeWidth={1.6} />;

  return (
    <SettingsPage section="profile">
      {profile.isPending || profile.error ? (
        <QueryStatus q={profile} lines={3} />
      ) : (
        <Row>
          <AppText variant="micro">{t("settings.account")}</AppText>
          <Field label={t("account.email")} value={profile.data?.email ?? user?.email ?? ""} editable={false} ltr icon={icon(Mail)} />
          <Field label={t("account.name")} value={name} onChangeText={setName} autoComplete="name" icon={icon(User)} />
          <Field
            label={t("account.timezone")}
            value={timezone}
            onChangeText={setTimezone}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Asia/Riyadh"
            ltr
            icon={icon(Globe)}
          />
          {error ? <ErrorLine text={error} /> : null}
          <View style={{ marginTop: 4 }}>
            <PrimaryButton
              label={t("account.saveProfile")}
              icon={<Check size={18} color={p.onAction} strokeWidth={1.8} />}
              loading={save.isPending}
              onPress={() => save.mutate()}
            />
          </View>
        </Row>
      )}
    </SettingsPage>
  );
}
