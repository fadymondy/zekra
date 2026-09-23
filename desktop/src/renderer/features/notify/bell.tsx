import { Bell } from "lucide-react";

import { badgeLabel } from "@mobile/features/notify/notify-core";

import { Button } from "@/components/ui/button";

import { useI18n } from "../../lib/i18n";
import { useRouter } from "../../shell/router";
import { useNotifyState } from "./store";

/** The title bar's bell: opens the center; a gold unread badge like the web's. */
export function NotificationBell() {
  const { t } = useI18n();
  const { route, navigate } = useRouter();
  const { unread, available } = useNotifyState();
  const badge = available === false ? null : badgeLabel(unread);
  const active = route.name === "notifications";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="relative"
      aria-current={active ? "page" : undefined}
      aria-label={badge ? t("notify.bellUnread", { count: badge }) : t("notify.bell")}
      title={t("notify.bell")}
      onClick={() => navigate({ name: "notifications" })}
    >
      <Bell className={active ? "text-foreground" : undefined} />
      {badge ? (
        <span
          aria-hidden
          className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
        >
          {badge}
        </span>
      ) : null}
    </Button>
  );
}
