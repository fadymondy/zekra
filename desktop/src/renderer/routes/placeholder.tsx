import type { LucideIcon } from "lucide-react";

import { useI18n } from "../lib/i18n";

/** Stand-in body for a route whose feature has not landed yet. */
export function ComingSoon({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-md border border-border/60 bg-pane-raised text-muted-foreground">
          <Icon className="size-5" />
        </span>
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{body ?? t("shell.comingSoonBody")}</p>
        <span className="grid-micro text-muted-foreground">{t("shell.comingSoon")}</span>
      </div>
    </div>
  );
}
