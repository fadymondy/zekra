import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { setApiBaseUrl } from "../../lib/api";
import type { ThemeChoice } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { Group, Row, Segmented, SettingsHeader } from "./ui";

/*
Settings ▸ General: appearance (theme → AppSettings.theme; main mirrors it into
nativeTheme.themeSource, so menus, dialogs and prefers-color-scheme agree),
language (EN / العربية, mirrors the whole app) and the API origin (reachable
signed out, to point the app at a self-hosted Zekra before signing in).
*/
export function GeneralSettings() {
  const { t, locale, setLocale } = useI18n();
  const { settings, patch } = useSession();
  const [apiBaseUrl, setBase] = useState(settings.apiBaseUrl);
  useEffect(() => setBase(settings.apiBaseUrl), [settings.apiBaseUrl]);

  async function saveBase() {
    const clean = apiBaseUrl.trim().replace(/\/+$/, "");
    let ok = false;
    try {
      ok = ["https:", "http:"].includes(new URL(clean).protocol);
    } catch {
      ok = false;
    }
    if (!ok) {
      toast.error(t("settings.apiBase"));
      return;
    }
    await patch({ apiBaseUrl: clean });
    setApiBaseUrl(clean);
    toast.success(t("action.saved"));
  }

  return (
    <>
      <SettingsHeader title={t("settings.section.general")} />

      <Group title={t("settings.x.preferences")}>
        <Row label={t("settings.theme")} hint={t("settingsx.themeBody")}>
          <Segmented<ThemeChoice>
            label={t("settings.theme")}
            value={settings.theme}
            onChange={(theme) => void patch({ theme })}
            options={[
              { value: "system", label: t("settings.themeSystem") },
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
            ]}
          />
        </Row>
        <Row label={t("settings.language")} hint={t("settingsx.languageBody")}>
          <Segmented<"en" | "ar">
            label={t("settings.language")}
            value={locale}
            onChange={(id) => {
              setLocale(id);
              void patch({ locale: id });
            }}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
            ]}
          />
        </Row>
      </Group>

      <Group title={t("settings.apiBase")} description={t("settingsx.apiBaseBody")}>
        <Row label={t("settings.apiBase")} htmlFor="api-base" stack>
          <Input
            id="api-base"
            dir="ltr"
            className="font-grid-mono"
            value={apiBaseUrl}
            onChange={(e) => setBase(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveBase()}
          />
          <Button onClick={() => void saveBase()} disabled={apiBaseUrl.trim() === settings.apiBaseUrl}>
            {t("action.save")}
          </Button>
        </Row>
      </Group>
    </>
  );
}
