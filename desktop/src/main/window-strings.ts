// Strings for the app windows (app-windows.ts) and the menubar menu (tray.ts):
// window titles, tray items, sync status. EN + AR, following the menu locale
// (menu-strings.ts). The Arabic product name is ذكرة — never ذكرى.
"use strict";

import { getMenuLocale } from "./menu-strings";

const en = {
  settingsTitle: "Settings",
  spotlightTitle: "Search Zekra",
  newBrainTitle: "New Brain",
  newNoteTitle: "New Note",
  // tray
  open: "Open Zekra",
  newNote: "New Note",
  newBrain: "New Brain…",
  search: "Search…",
  quickCapture: "Quick Capture",
  notifications: "Notifications",
  notificationsUnread: "Notifications ({count} unread)",
  recentNotes: "Recent Notes",
  noRecent: "No recent notes",
  brains: "Brains",
  allBrains: "All Brains",
  noBrains: "No brains yet",
  syncNow: "Sync Now",
  settings: "Settings…",
  about: "About Zekra",
  untitled: "Untitled",
  // sync status line
  syncIdle: "Synced",
  syncIdleAt: "Synced {when}",
  syncSyncing: "Syncing…",
  syncOffline: "Offline",
  syncPaused: "Sync paused",
  syncError: "Last sync failed",
  syncSignedOut: "Not signed in",
  syncDisabled: "Offline copy is off",
  syncPending: "{n} waiting",
  justNow: "just now",
  minutesAgo: "{n} min ago",
  hoursAgo: "{n} h ago",
};

const ar: typeof en = {
  settingsTitle: "الإعدادات",
  spotlightTitle: "البحث في ذكرة",
  newBrainTitle: "دماغ جديد",
  newNoteTitle: "ملاحظة جديدة",
  open: "فتح ذكرة",
  newNote: "ملاحظة جديدة",
  newBrain: "دماغ جديد…",
  search: "بحث…",
  quickCapture: "التقاط سريع",
  notifications: "الإشعارات",
  notificationsUnread: "الإشعارات ({count} غير مقروءة)",
  recentNotes: "الملاحظات الأخيرة",
  noRecent: "لا توجد ملاحظات حديثة",
  brains: "الأدمغة",
  allBrains: "كل الأدمغة",
  noBrains: "لا توجد أدمغة بعد",
  syncNow: "زامن الآن",
  settings: "الإعدادات…",
  about: "حول ذكرة",
  untitled: "بلا عنوان",
  syncIdle: "تمت المزامنة",
  syncIdleAt: "تمت المزامنة {when}",
  syncSyncing: "جارٍ المزامنة…",
  syncOffline: "غير متصل",
  syncPaused: "المزامنة متوقفة مؤقتًا",
  syncError: "فشلت آخر مزامنة",
  syncSignedOut: "لم يتم تسجيل الدخول",
  syncDisabled: "النسخة المحلية متوقفة",
  syncPending: "{n} بالانتظار",
  justNow: "الآن",
  minutesAgo: "قبل {n} د",
  hoursAgo: "قبل {n} س",
};

export type WindowStrings = typeof en;

export function ws(): WindowStrings {
  return getMenuLocale() === "ar" ? ar : en;
}
