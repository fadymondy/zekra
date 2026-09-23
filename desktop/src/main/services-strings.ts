// Strings for the desktop services (Dock menu, Jump List, Quick Capture menu
// item, share fallbacks, conflict copies). EN + AR, following the menu locale
// (menu-strings.ts). The Arabic product name is ذكرة.
"use strict";

import { getMenuLocale } from "./menu-strings";

const en = {
  newNote: "New Note",
  newWindow: "New Window",
  quickCapture: "Quick Capture",
  quickCaptureDesc: "Capture a note from anywhere",
  captureClipboard: "Capture Clipboard",
  newNoteDesc: "Open Zekra with a new note",
  recentNotes: "Recent Notes",
  syncNow: "Sync Now",
  conflictedCopy: "conflicted copy",
  captureTitle: "Quick Capture",
  sharedCopied: "Copied to the clipboard",
  untitled: "Untitled",
};

const ar: typeof en = {
  newNote: "ملاحظة جديدة",
  newWindow: "نافذة جديدة",
  quickCapture: "التقاط سريع",
  quickCaptureDesc: "التقط ملاحظة من أي مكان",
  captureClipboard: "التقاط الحافظة",
  newNoteDesc: "افتح ذكرة بملاحظة جديدة",
  recentNotes: "الملاحظات الأخيرة",
  syncNow: "مزامنة الآن",
  conflictedCopy: "نسخة متعارضة",
  captureTitle: "التقاط سريع",
  sharedCopied: "نُسخ إلى الحافظة",
  untitled: "بلا عنوان",
};

export function ss(): typeof en {
  return getMenuLocale() === "ar" ? ar : en;
}
