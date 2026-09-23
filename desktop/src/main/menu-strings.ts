// Native menu / tray / dialog strings, EN + AR. The main process cannot use the
// renderer's i18n provider, so it carries its own small dictionary; the menu
// is rebuilt whenever the app locale changes (settings patch -> menu.ts).
//
// The Arabic product name is ذكرة — never ذكرى.
"use strict";

import type { LocaleId } from "../shared/ipc";

const en = {
  appName: "Zekra",
  about: "About Zekra",
  settings: "Settings…",
  services: "Services",
  hide: "Hide Zekra",
  hideOthers: "Hide Others",
  showAll: "Show All",
  quit: "Quit Zekra",

  file: "File",
  newNote: "New Note",
  newBrain: "New Brain",
  openMarkdown: "Open Markdown…",
  importFrom: "Import from",
  importAppleNotes: "Apple Notes…",
  importGoogleKeep: "Google Keep…",
  importNotion: "Notion…",
  importMarkdownFolder: "Markdown Folder…",
  export: "Export",
  exportMd: "Markdown (.md)",
  exportHtml: "HTML (.html)",
  exportPdf: "PDF (.pdf)",
  exportDocx: "Word (.docx)",
  exportPng: "Image (.png)",
  exportTxt: "Plain Text (.txt)",
  save: "Save",
  closeTab: "Close Tab",
  reopenTab: "Reopen Closed Tab",
  closeWindow: "Close Window",
  signOut: "Sign Out",

  edit: "Edit",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  pasteAndMatch: "Paste and Match Style",
  delete: "Delete",
  selectAll: "Select All",
  find: "Find…",

  view: "View",
  toggleSidebar: "Toggle Sidebar",
  toggleOutline: "Toggle Outline",
  commandPalette: "Command Palette…",
  nextTab: "Next Tab",
  prevTab: "Previous Tab",
  actualSize: "Actual Size",
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
  fullscreen: "Toggle Full Screen",
  reload: "Reload",
  devtools: "Toggle Developer Tools",

  window: "Window",
  minimize: "Minimize",
  zoom: "Zoom",
  front: "Bring All to Front",

  help: "Help",
  website: "Zekra on the Web",
  reportIssue: "Report an Issue…",
  checkUpdates: "Check for Updates…",

  trayOpen: "Open Zekra",
  traySearch: "Search…",
  trayMcpUnknown: "MCP: status unknown",
  trayMcpConnected: "MCP: connected",
  trayMcpDisconnected: "MCP: disconnected",

  openMarkdownTitle: "Open Markdown",
  markdownFiles: "Markdown",
  updateTitle: "Software Update",
  updateNone: "You’re up to date.",
  updateNoneDetail: "Zekra {version} is the newest version available.",
  updateNoReleases: "No updates are published yet.",
  updateFailed: "Could not check for updates.",
  updateAvailable: "Zekra {version} is available.",
  updateAvailableDetail: "It is downloading in the background. You’ll be asked to restart when it is ready.",
  updateReady: "Zekra {version} is ready to install.",
  updateReadyDetail: "Restart now to finish updating, or it will install the next time you quit.",
  updateRestart: "Restart Now",
  updateLater: "Later",
  ok: "OK",
  devBuild: "Updates are disabled in development builds.",
  // Native shell: Note / Brain / Go menus
  toggleList: "Toggle Notes List",
  note: "Note",
  openInNewWindow: "Open in New Window",
  pin: "Pin / Unpin",
  archive: "Archive / Unarchive",
  appearance: "Icon & Colour…",
  versions: "Version History…",
  copyMarkdown: "Copy as Markdown",
  deleteNote: "Delete Note…",
  brain: "Brain",
  brainNotes: "Notes",
  brainPresentations: "Presentations",
  brainVault: "Vault",
  exportBrain: "Export Brain…",
  go: "Go",
  back: "Back",
  allBrains: "All Brains",
  search: "Search",
  inbox: "Notifications",
};

export type MenuStrings = typeof en;

const ar: MenuStrings = {
  appName: "ذكرة",
  about: "حول ذكرة",
  settings: "الإعدادات…",
  services: "الخدمات",
  hide: "إخفاء ذكرة",
  hideOthers: "إخفاء الآخرين",
  showAll: "إظهار الكل",
  quit: "إنهاء ذكرة",

  file: "ملف",
  newNote: "ملاحظة جديدة",
  newBrain: "دماغ جديد",
  openMarkdown: "فتح ملف ماركداون…",
  importFrom: "استيراد من",
  importAppleNotes: "ملاحظات Apple…",
  importGoogleKeep: "Google Keep…",
  importNotion: "Notion…",
  importMarkdownFolder: "مجلد ماركداون…",
  export: "تصدير",
  exportMd: "ماركداون (.md)",
  exportHtml: "HTML (.html)",
  exportPdf: "PDF (.pdf)",
  exportDocx: "Word (.docx)",
  exportPng: "صورة (.png)",
  exportTxt: "نص عادي (.txt)",
  save: "حفظ",
  closeTab: "إغلاق التبويب",
  reopenTab: "إعادة فتح التبويب المغلق",
  closeWindow: "إغلاق النافذة",
  signOut: "تسجيل الخروج",

  edit: "تحرير",
  undo: "تراجع",
  redo: "إعادة",
  cut: "قص",
  copy: "نسخ",
  paste: "لصق",
  pasteAndMatch: "لصق ومطابقة النمط",
  delete: "حذف",
  selectAll: "تحديد الكل",
  find: "بحث…",

  view: "عرض",
  toggleSidebar: "إظهار/إخفاء الشريط الجانبي",
  toggleOutline: "إظهار/إخفاء المخطط",
  commandPalette: "لوحة الأوامر…",
  nextTab: "التبويب التالي",
  prevTab: "التبويب السابق",
  actualSize: "الحجم الفعلي",
  zoomIn: "تكبير",
  zoomOut: "تصغير",
  fullscreen: "ملء الشاشة",
  reload: "إعادة التحميل",
  devtools: "أدوات المطوّر",

  window: "نافذة",
  minimize: "تصغير إلى Dock",
  zoom: "تكبير/تصغير",
  front: "إحضار الكل إلى الأمام",

  help: "مساعدة",
  website: "ذكرة على الويب",
  reportIssue: "الإبلاغ عن مشكلة…",
  checkUpdates: "البحث عن تحديثات…",

  trayOpen: "فتح ذكرة",
  traySearch: "بحث…",
  trayMcpUnknown: "MCP: الحالة غير معروفة",
  trayMcpConnected: "MCP: متصل",
  trayMcpDisconnected: "MCP: غير متصل",

  openMarkdownTitle: "فتح ملف ماركداون",
  markdownFiles: "ماركداون",
  updateTitle: "تحديث البرنامج",
  updateNone: "لديك أحدث إصدار.",
  updateNoneDetail: "ذكرة {version} هو أحدث إصدار متاح.",
  updateNoReleases: "لم تُنشر أي تحديثات بعد.",
  updateFailed: "تعذّر البحث عن تحديثات.",
  updateAvailable: "يتوفر الإصدار {version} من ذكرة.",
  updateAvailableDetail: "يجري تنزيله في الخلفية. سيُطلب منك إعادة التشغيل عند جاهزيته.",
  updateReady: "الإصدار {version} من ذكرة جاهز للتثبيت.",
  updateReadyDetail: "أعد التشغيل الآن لإكمال التحديث، أو سيُثبَّت عند الإنهاء في المرة القادمة.",
  updateRestart: "إعادة التشغيل الآن",
  updateLater: "لاحقًا",
  ok: "حسنًا",
  devBuild: "التحديثات معطّلة في نسخ التطوير.",
  // Native shell: Note / Brain / Go menus
  toggleList: "إظهار/إخفاء قائمة الملاحظات",
  note: "ملاحظة",
  openInNewWindow: "فتح في نافذة جديدة",
  pin: "تثبيت / إلغاء التثبيت",
  archive: "أرشفة / إلغاء الأرشفة",
  appearance: "الأيقونة واللون…",
  versions: "سجل الإصدارات…",
  copyMarkdown: "نسخ بصيغة Markdown",
  deleteNote: "حذف الملاحظة…",
  brain: "الدماغ",
  brainNotes: "الملاحظات",
  brainPresentations: "العروض",
  brainVault: "الخزنة",
  exportBrain: "تصدير الدماغ…",
  go: "انتقال",
  back: "رجوع",
  allBrains: "كل الأدمغة",
  search: "البحث",
  inbox: "الإشعارات",
};

let current: LocaleId = "en";

export function setMenuLocale(locale: LocaleId): void {
  current = locale === "ar" ? "ar" : "en";
}

export function getMenuLocale(): LocaleId {
  return current;
}

/** The dictionary for the current app locale. */
export function s(): MenuStrings {
  return current === "ar" ? ar : en;
}

export function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}
