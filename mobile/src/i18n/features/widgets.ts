import { defineDict } from "@/i18n/define";

// Strings owned by the home-screen widgets (MH-360). Keys are prefixed
// "widgets." to stay unique. The widgets cannot look strings up themselves
// (the iOS one runs in an isolated JS runtime, the Android one headless), so
// src/features/widgets/labels.ts resolves these into the snapshot the app
// writes, in the app's chosen language.
export default defineDict({
  en: {
    "widgets.title": "Brains",
    "widgets.memories": "Memories",
    "widgets.recalls": "Recalls",
    "widgets.openGaps": "Open gaps",
    "widgets.stat.brains": "Brains",
    "widgets.stat.memories": "Memories",
    "widgets.stat.nodes": "Graph nodes",
    "widgets.stat.recalls24h": "Recalls · 24h",
    "widgets.stat.openGaps": "Open gaps",
    "widgets.total": "{count} memories",
    "widgets.updated": "Updated {when}",
    "widgets.signedOutTitle": "Zekra",
    "widgets.signedOutBody": "Sign in to see your brains here.",
    "widgets.emptyTitle": "No brains yet",
    "widgets.emptyBody": "Open Zekra to create your first brain.",
    "widgets.more": "+{count} more",
  },
  ar: {
    "widgets.title": "الأدمغة",
    "widgets.memories": "ذكريات",
    "widgets.recalls": "استرجاع",
    "widgets.openGaps": "فجوات مفتوحة",
    "widgets.stat.brains": "الأدمغة",
    "widgets.stat.memories": "الذكريات",
    "widgets.stat.nodes": "عُقد المخطط",
    "widgets.stat.recalls24h": "الاسترجاع · 24 ساعة",
    "widgets.stat.openGaps": "فجوات مفتوحة",
    "widgets.total": "{count} ذكرى",
    "widgets.updated": "آخر تحديث {when}",
    "widgets.signedOutTitle": "ذكرة",
    "widgets.signedOutBody": "سجّل الدخول لترى أدمغتك هنا.",
    "widgets.emptyTitle": "لا توجد أدمغة بعد",
    "widgets.emptyBody": "افتح ذكرة لإنشاء أول دماغ.",
    "widgets.more": "+{count} أخرى",
  },
});
