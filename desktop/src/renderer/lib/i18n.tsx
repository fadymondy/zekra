import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { LocaleId } from "./bridge";

// Bilingual, same as the web console and the mobile app. The Arabic product
// name is ذكرة — never ذكرى.
const en = {
  "app.name": "Zekra",
  "app.tagline": "Sign in to your memory organ",

  "action.signIn": "Sign in",
  "action.signingIn": "Signing in…",
  "action.signOut": "Sign out",
  "action.settings": "Settings",
  "action.switchBrain": "Switch brain",
  "action.save": "Save",
  "action.saved": "Saved",
  "action.unsaved": "Save changes",
  "action.close": "Close",
  "action.newNote": "New note",
  "action.delete": "Delete",
  "action.cancel": "Cancel",
  "action.verify": "Verify and continue",

  "auth.email": "Email",
  "auth.password": "Password",
  "auth.twoFactor": "Two-factor check",
  "auth.authCode": "Authenticator code",
  "auth.recoveryCode": "Recovery code",
  "auth.useRecovery": "Use a recovery code",
  "auth.useAuthenticator": "Use authenticator instead",
  "auth.connecting": "Connecting to",
  "auth.failed": "Sign in failed",

  "brains.title": "Choose a brain",
  "brains.empty": "No brains yet.",
  "brains.memories": "memories",
  "brains.loading": "Loading brains",

  "notes.title": "Notes",
  "notes.empty": "No notes yet.",
  "notes.search": "Search notes",
  "notes.untitled": "Untitled",
  "notes.select": "Select a note, or create a new one.",
  "notes.showArchived": "Show archived",
  "notes.pinned": "pinned",
  "notes.archived": "archived",
  "notes.deleteConfirm": "Delete this note?",
  "notes.deleteBody": "Zekra keeps its version history, but the note disappears from your active list.",

  "row.pin": "Pin",
  "row.unpin": "Unpin",
  "row.archive": "Archive",
  "row.unarchive": "Restore",
  "row.archiveConfirm": "Archive this note?",
  "row.archiveBody": "It leaves your active list. You can restore it from the archived view at any time.",
  "row.unarchiveConfirm": "Restore this note?",
  "row.unarchiveBody": "It returns to your active list.",
  "editor.title": "Title",
  "editor.edit": "Edit",
  "editor.preview": "Preview",
  "editor.empty": "Nothing written yet — switch to Edit.",
  "editor.placeholder": "Write what matters…",

  "search.title": "Search",
  "search.placeholder": "Ask your brains anything…",
  "search.allBrains": "All brains",
  "search.empty": "No results",
  "search.emptyBody": "Try different words — search reads meaning, not just keywords.",
  "search.start": "Search your memory",
  "search.startBody": "Type a question and Zekra will find what it knows.",
  "search.searching": "Searching…",

  "spotlight.label": "Search",
  "spotlight.description": "Search your brain and jump anywhere",
  "spotlight.placeholder": "Search memories, or jump to a page…",
  "spotlight.searching": "Searching your brain…",
  "spotlight.empty": "Nothing found. Try different words — search reads meaning, not just keywords.",
  "spotlight.hint": "Type to search your memories.",
  "spotlight.memories": "Memories",
  "spotlight.goTo": "Actions",
  "settings.title": "Settings",
  "settings.apiBase": "API base URL",
  "settings.theme": "Theme",
  "settings.language": "Language",
  "settings.signedInAs": "Signed in as",
  "settings.version": "Version",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
} as const;

export type TKey = keyof typeof en;

const ar: Record<TKey, string> = {
  "app.name": "ذكرة",
  "app.tagline": "سجّل الدخول إلى عضو الذاكرة",

  "action.signIn": "تسجيل الدخول",
  "action.signingIn": "جارٍ تسجيل الدخول…",
  "action.signOut": "تسجيل الخروج",
  "action.settings": "الإعدادات",
  "action.switchBrain": "تبديل الدماغ",
  "action.save": "حفظ",
  "action.saved": "تم الحفظ",
  "action.unsaved": "حفظ التغييرات",
  "action.close": "إغلاق",
  "action.newNote": "ملاحظة جديدة",
  "action.delete": "حذف",
  "action.cancel": "إلغاء",
  "action.verify": "تحقّق وتابع",

  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.twoFactor": "التحقق بخطوتين",
  "auth.authCode": "رمز المصادقة",
  "auth.recoveryCode": "رمز الاسترداد",
  "auth.useRecovery": "استخدم رمز استرداد",
  "auth.useAuthenticator": "استخدم تطبيق المصادقة",
  "auth.connecting": "الاتصال بـ",
  "auth.failed": "فشل تسجيل الدخول",

  "brains.title": "اختر دماغًا",
  "brains.empty": "لا توجد أدمغة بعد.",
  "brains.memories": "ذكرى",
  "brains.loading": "جارٍ تحميل الأدمغة",

  "notes.title": "الملاحظات",
  "notes.empty": "لا توجد ملاحظات بعد.",
  "notes.search": "ابحث في الملاحظات",
  "notes.untitled": "بدون عنوان",
  "notes.select": "اختر ملاحظة، أو أنشئ واحدة جديدة.",
  "notes.showArchived": "عرض المؤرشفة",
  "notes.pinned": "مثبّتة",
  "notes.archived": "مؤرشفة",
  "notes.deleteConfirm": "حذف هذه الملاحظة؟",
  "notes.deleteBody": "تحتفظ ذكرة بسجل الإصدارات، لكن الملاحظة ستختفي من قائمتك النشطة.",

  "row.pin": "تثبيت",
  "row.unpin": "إلغاء التثبيت",
  "row.archive": "أرشفة",
  "row.unarchive": "استعادة",
  "row.archiveConfirm": "أرشفة هذه الملاحظة؟",
  "row.archiveBody": "ستغادر قائمتك النشطة. يمكنك استعادتها من عرض المؤرشفة في أي وقت.",
  "row.unarchiveConfirm": "استعادة هذه الملاحظة؟",
  "row.unarchiveBody": "ستعود إلى قائمتك النشطة.",
  "editor.title": "العنوان",
  "editor.edit": "تحرير",
  "editor.preview": "معاينة",
  "editor.empty": "لا يوجد محتوى بعد — انتقل إلى التحرير.",
  "editor.placeholder": "اكتب ما يهم…",

  "search.title": "البحث",
  "search.placeholder": "اسأل أدمغتك عن أي شيء…",
  "search.allBrains": "كل الأدمغة",
  "search.empty": "لا نتائج",
  "search.emptyBody": "جرّب كلمات أخرى — البحث يقرأ المعنى لا الكلمات فقط.",
  "search.start": "ابحث في ذاكرتك",
  "search.startBody": "اكتب سؤالًا وستجد ذكرة ما تعرفه.",
  "search.searching": "جارٍ البحث…",

  "spotlight.label": "البحث",
  "spotlight.description": "ابحث في دماغك وانتقل إلى أي مكان",
  "spotlight.placeholder": "ابحث في الذكريات، أو انتقل إلى صفحة…",
  "spotlight.searching": "جارٍ البحث في دماغك…",
  "spotlight.empty": "لا نتائج. جرّب كلمات أخرى — البحث يقرأ المعنى لا الكلمات فقط.",
  "spotlight.hint": "اكتب للبحث في ذكرياتك.",
  "spotlight.memories": "الذكريات",
  "spotlight.goTo": "إجراءات",
  "settings.title": "الإعدادات",
  "settings.apiBase": "عنوان الواجهة البرمجية",
  "settings.theme": "السمة",
  "settings.language": "اللغة",
  "settings.signedInAs": "مسجّل الدخول باسم",
  "settings.version": "الإصدار",
  "settings.themeLight": "فاتح",
  "settings.themeDark": "داكن",
};

const DICTS: Record<LocaleId, Record<string, string>> = { en, ar };

type I18nValue = {
  locale: LocaleId;
  isRtl: boolean;
  t: (key: TKey) => string;
  setLocale: (locale: LocaleId) => void;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  isRtl: false,
  t: (k) => en[k],
  setLocale: () => {},
});

export function I18nProvider({ initial, onChange, children }: {
  initial: LocaleId;
  onChange?: (locale: LocaleId) => void;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<LocaleId>(initial);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((next: LocaleId) => {
    setLocaleState(next);
    onChange?.(next);
  }, [onChange]);

  const value = useMemo<I18nValue>(() => ({
    locale,
    isRtl: locale === "ar",
    t: (key: TKey) => DICTS[locale][key] ?? en[key],
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
