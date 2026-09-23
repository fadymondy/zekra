import { Row, Segmented } from "@/components/ui";
import { SettingsLabel, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n, type Locale } from "@/lib/i18n";
import { useTheme, type ThemeMode } from "@/theme";

// Settings → Appearance: light/dark and the app language, side by side.
export default function AppearanceScreen() {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode } = useTheme();
  return (
    <SettingsPage section="appearance">
      <Row>
        <SettingsLabel title={t("settings.theme")} body={t("settings.x.themeBody")} />
        <Segmented<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "system", label: t("settings.themeSystem") },
            { value: "light", label: t("settings.themeLight") },
            { value: "dark", label: t("settings.themeDark") },
          ]}
        />
      </Row>
      <Row>
        <SettingsLabel title={t("settings.language")} body={t("settings.x.languageBody")} />
        <Segmented<Locale>
          value={locale}
          onChange={setLocale}
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </Row>
    </SettingsPage>
  );
}
