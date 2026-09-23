import { BellRing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { setNotifyPrefs, useNotifyPrefs } from "../notify/prefs";
import { useNotifyState } from "../notify/store";
import { Group, Row, SettingsHeader } from "./ui";

/*
Settings ▸ Notifications: how the inbox reaches the desktop — macOS banners
while Zekra is in the background (features/notify/agent.tsx), their sound, and
the Dock badge. Device-only (features/notify/prefs.ts). macOS itself may still
block banners in System Settings ▸ Notifications ▸ Zekra.
*/
export function NotificationSettings() {
  const { t } = useI18n();
  const prefs = useNotifyPrefs();
  const { available } = useNotifyState();

  function test() {
    void bridge().notify({
      title: t("notifyx.testTitle"),
      body: t("notifyx.testBody"),
      route: "notifications",
      silent: !prefs.sound,
    });
  }

  return (
    <>
      <SettingsHeader title={t("settings.section.notifications")} description={t("push.offBody")} />

      {available === false ? (
        <p className="rounded-md border border-border/60 bg-pane-raised px-4 py-3 text-sm text-muted-foreground">{t("notify.unavailableBody")}</p>
      ) : null}

      <Group>
        <Row label={t("notifyx.osTitle")} hint={t("notifyx.osBody")}>
          <Switch checked={prefs.os} onCheckedChange={(v) => setNotifyPrefs({ os: v })} aria-label={t("notifyx.osTitle")} />
        </Row>
        <Row label={t("notifyx.sound")} hint={t("notifyx.soundBody")}>
          <Switch
            checked={prefs.sound}
            disabled={!prefs.os}
            onCheckedChange={(v) => setNotifyPrefs({ sound: v })}
            aria-label={t("notifyx.sound")}
          />
        </Row>
        <Row label={t("notifyx.badge")} hint={t("notifyx.badgeBody")}>
          <Switch checked={prefs.badge} onCheckedChange={(v) => setNotifyPrefs({ badge: v })} aria-label={t("notifyx.badge")} />
        </Row>
      </Group>

      <div>
        <Button variant="outline" onClick={test} disabled={!prefs.os}>
          <BellRing />
          {t("notifyx.test")}
        </Button>
      </div>
    </>
  );
}
