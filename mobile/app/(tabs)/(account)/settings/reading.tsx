import { ReadingSettings } from "@/components/reading-settings";
import { Row } from "@/components/ui";
import { SettingsLabel, SettingsPage } from "@/features/settings/settings-nav";
import { useI18n } from "@/lib/i18n";

// Settings → Reading: the reading theme (repaints the app) and note typography.
export default function ReadingScreen() {
  const { t } = useI18n();
  return (
    <SettingsPage section="reading">
      <Row style={{ gap: 14 }}>
        <SettingsLabel title={t("reading.title")} body={t("settings.x.readingBody")} />
        <ReadingSettings />
      </Row>
    </SettingsPage>
  );
}
