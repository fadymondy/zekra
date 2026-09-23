import * as brainsCore from "@/features/brains/brains-core";
import { translate, type Locale } from "@/lib/i18n";

import type { BrainsHelpers, WidgetLabels } from "./widgets-core";

/** The real brains helpers, handed to the pure widgets-core functions. */
export const helpers: BrainsHelpers = brainsCore;

/** The widget strings in `locale` (src/i18n/features/widgets.ts). */
export function widgetLabels(locale: Locale): WidgetLabels {
  const t = (k: Parameters<typeof translate>[1]) => translate(locale, k);
  return {
    title: t("widgets.title"),
    memories: t("widgets.memories"),
    recalls: t("widgets.recalls"),
    openGaps: t("widgets.openGaps"),
    statBrains: t("widgets.stat.brains"),
    statMemories: t("widgets.stat.memories"),
    statNodes: t("widgets.stat.nodes"),
    statRecalls24h: t("widgets.stat.recalls24h"),
    statOpenGaps: t("widgets.stat.openGaps"),
    total: t("widgets.total"),
    updated: t("widgets.updated"),
    signedOutTitle: t("widgets.signedOutTitle"),
    signedOutBody: t("widgets.signedOutBody"),
    emptyTitle: t("widgets.emptyTitle"),
    emptyBody: t("widgets.emptyBody"),
    more: t("widgets.more"),
  };
}
