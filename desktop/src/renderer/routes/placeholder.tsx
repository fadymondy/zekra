import type { LucideIcon } from "lucide-react";

import { useI18n } from "../lib/i18n";

/** Stand-in body for a route whose feature has not landed yet. */
export function ComingSoon({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string }) {
  const { t } = useI18n();
  return (
    <div className="grid-hatch flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-md border border-line bg-grid-card text-grid-muted">
          <Icon className="size-5" />
        </span>
        <h2 className="text-base font-medium text-grid-fg">{title}</h2>
        <p className="text-sm text-grid-muted">{body ?? t("shell.comingSoonBody")}</p>
        <span className="grid-micro text-grid-muted">{t("shell.comingSoon")}</span>
      </div>
    </div>
  );
}
