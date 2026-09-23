import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { FEATURE_DICTS, type FeatureKey } from "@mobile/i18n/features";
import type { DictKey } from "@mobile/i18n/define";

// Desktop feature dictionaries (src/renderer/i18n/*.ts, MH-450). MERGE POINT:
// import yours here, add it to DESKTOP_FEATURE_DICTS and to DesktopFeatureKey.
import presentationsVaultLock from "../i18n/presentations-vault-lock";
import account from "../i18n/account"; // search, notifications, settings, sign-in
import notesWs from "../i18n/notes"; // brains home, notes workspace, spotlight
import mid from "../i18n/mid"; // importers, opened documents, markdown extras, updates

const DESKTOP_FEATURE_DICTS = [presentationsVaultLock, account, notesWs, mid];
type DesktopFeatureKey = DictKey<typeof presentationsVaultLock> | DictKey<typeof account> | DictKey<typeof notesWs> | DictKey<typeof mid>;

import type { LocaleId } from "./bridge";

/*
Bilingual, same as the web console and the mobile app. The Arabic product
name is ذكرة — never ذكرى.

Two sources, one `t()`:
  1. The mobile app's FEATURE dictionaries (mobile/src/i18n/features/*.ts,
     imported via the @mobile alias). They are pure TS, EN/AR at key parity
     (enforced by defineDict), and cover brains, notes, editor, presentations,
     vault, notifications, settings, auth/app-lock… Feature teams should REUSE
     those keys rather than invent desktop copies, so the two apps say the same
     thing.
  2. The desktop's own dictionary below: shell chrome and anything
     desktop-specific. It is merged OVER the mobile ones, so an existing desktop
     key keeps its desktop wording even if mobile defines the same key.

Placeholders use mobile's syntax: t("nav.scopeIn", { brain: "flowos" }) with
"In {brain}".
*/
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
  "brains.metric.recalls": "recalls",
  "brains.metric.types": "types",
  "brains.loading": "Loading brains",

  "notes.title": "Notes",
  "notes.empty": "No notes yet.",
  "notes.loadingMore": "Loading more…",
  "notes.search": "Search notes",
  "notes.untitled": "Untitled",
  "notes.select": "Select a note, or create a new one.",
  "notes.showArchived": "Show archived",
  "notes.pinned": "pinned",
  "notes.archived": "archived",
  "notes.deleteConfirm": "Delete this note?",
  "notes.deleteBody": "Zekra keeps its version history, but the note disappears from your active list.",

  "row.appearance": "Icon & colour",
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
  "editor.visual": "Visual",
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
  "spotlight.recent": "Recent",
  "spotlight.scopeBrain": "This brain",
  "spotlight.scopeAll": "All brains",
  "spotlight.navigate": "navigate",
  "spotlight.open": "open",
  "spotlight.close": "close",
  "spotlight.searching": "Searching your brain…",
  "spotlight.empty": "Nothing found. Try different words — search reads meaning, not just keywords.",
  "spotlight.hint": "Type to search your memories.",
  "spotlight.memories": "Memories",
  "spotlight.goTo": "Actions",
  "reading.typography": "Typography",
  "reading.typographyHint": "Reading font and size for the preview pane.",
  "reading.fontFamily": "Font family",
  "reading.fontFamilyHint": "Used for body text in the preview.",
  "reading.fontSize": "Body font size",
  "reading.fontSizeHint": "Larger sizes are easier on the eyes for long-form reading.",
  "reading.maxWidth": "Preview max-width",
  "reading.maxWidthHint": "Cap the column width of the rendered markdown. Full width at 0.",
  "reading.fullWidth": "Full width",
  "reading.editor": "Editor",
  "reading.editorHint": "Editing behaviour in the split and edit panes.",
  "reading.wordWrap": "Word wrap",
  "reading.wordWrapHint": "Soft-wrap long lines in the editor textarea. Off shows a horizontal scrollbar instead.",
  "reading.lineNumbers": "Show line numbers in code blocks",
  "reading.lineNumbersHint": "Adds a gutter to every fenced code block in the rendered preview.",
  "reading.autoSave": "Auto-save",
  "reading.autoSaveHint": "Off — manual Cmd/Ctrl+S only. On blur — save when the editor loses focus. Every 5s — periodic background save.",
  "reading.autoSaveOff": "Off",
  "reading.autoSaveBlur": "On blur",
  "reading.autoSaveInterval": "Every 5s",
  "reading.theme": "Reading theme",
  "reading.themeHint": "Repaints the whole app. Pick none to keep Zekra's own palette.",
  "reading.lightThemes": "Light themes",
  "reading.darkThemes": "Dark themes",
  "reading.ownPalette": "Use Zekra's own palette",
  "tree.title": "Explorer",
  "tree.empty": "No entities in this brain yet.",
  "tree.expand": "Expand",
  "tree.collapse": "Collapse",
  "tree.cycle": "Loops back to an item above",
  "tree.deep": "MAX",
  "tree.noChildren": "No outgoing relations.",
  "action.refresh": "Refresh",
  "action.retry": "Retry",
  "settings.title": "Settings",
  "settings.apiBase": "API base URL",
  "settings.theme": "Theme",
  "settings.language": "Language",
  "settings.signedInAs": "Signed in as",
  "settings.version": "Version",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeSystem": "System",
  "settings.section.general": "General",
  "settings.section.reading": "Reading",
  "settings.section.account": "Account",
  "settings.section.security": "Security",
  "settings.section.about": "About",
  "settings.checkUpdates": "Check for updates",
  "settings.installUpdate": "Restart to update",
  "settings.lockSoon": "App lock with Touch ID is coming in a later update.",

  "nav.brains": "Brains",
  "nav.search": "Search",
  "nav.presentations": "Presentations",
  "nav.notifications": "Notifications",
  "nav.settings": "Settings",
  "nav.back": "Back",
  "nav.primary": "Primary",

  "shell.search": "Search or jump to…",
  "shell.account": "Account",
  "shell.signedOut": "Not signed in",
  "shell.online": "Connected",
  "shell.offline": "Offline",
  "shell.noBrain": "No brain open",
  "shell.comingSoon": "Coming soon",
  "shell.comingSoonBody": "This part of Zekra for Mac is being built.",
  "shell.openedFile": "Opened {name}",
  "shell.signInLink": "Finishing sign-in…",
  "status.words": "words",
  "about.title": "About Zekra",
} as const;

/** Keys the desktop itself owns. */
export type DesktopKey = keyof typeof en;
/** Every key `t()` accepts: desktop + the shared mobile feature dictionaries. */
export type TKey = DesktopKey | FeatureKey | DesktopFeatureKey;

const ar: Record<DesktopKey, string> = {
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
  "brains.metric.recalls": "استرجاع",
  "brains.metric.types": "أنواع",
  "brains.loading": "جارٍ تحميل الأدمغة",

  "notes.title": "الملاحظات",
  "notes.empty": "لا توجد ملاحظات بعد.",
  "notes.loadingMore": "جارٍ تحميل المزيد…",
  "notes.search": "ابحث في الملاحظات",
  "notes.untitled": "بدون عنوان",
  "notes.select": "اختر ملاحظة، أو أنشئ واحدة جديدة.",
  "notes.showArchived": "عرض المؤرشفة",
  "notes.pinned": "مثبّتة",
  "notes.archived": "مؤرشفة",
  "notes.deleteConfirm": "حذف هذه الملاحظة؟",
  "notes.deleteBody": "تحتفظ ذكرة بسجل الإصدارات، لكن الملاحظة ستختفي من قائمتك النشطة.",

  "row.appearance": "الأيقونة واللون",

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
  "editor.visual": "مرئي",
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
  "spotlight.recent": "الأخيرة",
  "spotlight.scopeBrain": "هذا الدماغ",
  "spotlight.scopeAll": "كل الأدمغة",
  "spotlight.navigate": "تنقّل",
  "spotlight.open": "فتح",
  "spotlight.close": "إغلاق",
  "spotlight.searching": "جارٍ البحث في دماغك…",
  "spotlight.empty": "لا نتائج. جرّب كلمات أخرى — البحث يقرأ المعنى لا الكلمات فقط.",
  "spotlight.hint": "اكتب للبحث في ذكرياتك.",
  "spotlight.memories": "الذكريات",
  "spotlight.goTo": "إجراءات",
  "reading.typography": "الخطوط",
  "reading.typographyHint": "خط القراءة وحجمه في جزء المعاينة.",
  "reading.fontFamily": "عائلة الخط",
  "reading.fontFamilyHint": "يُستخدم لنص المتن في المعاينة.",
  "reading.fontSize": "حجم خط المتن",
  "reading.fontSizeHint": "الأحجام الأكبر أريح للعين في القراءة الطويلة.",
  "reading.maxWidth": "أقصى عرض للمعاينة",
  "reading.maxWidthHint": "حدّ عرض عمود الماركداون المعروض. العرض الكامل عند 0.",
  "reading.fullWidth": "عرض كامل",
  "reading.editor": "المحرر",
  "reading.editorHint": "سلوك التحرير في جزأي التقسيم والتحرير.",
  "reading.wordWrap": "التفاف النص",
  "reading.wordWrapHint": "لفّ الأسطر الطويلة في مربع التحرير. عند الإيقاف يظهر شريط تمرير أفقي بدلًا من ذلك.",
  "reading.lineNumbers": "إظهار أرقام الأسطر في كتل الشيفرة",
  "reading.lineNumbersHint": "يضيف حاشية جانبية لكل كتلة شيفرة في المعاينة.",
  "reading.autoSave": "الحفظ التلقائي",
  "reading.autoSaveHint": "إيقاف — حفظ يدوي بـ Cmd/Ctrl+S فقط. عند فقد التركيز — يحفظ عند خروج المؤشر من المحرر. كل ٥ ثوانٍ — حفظ دوري في الخلفية.",
  "reading.autoSaveOff": "إيقاف",
  "reading.autoSaveBlur": "عند فقد التركيز",
  "reading.autoSaveInterval": "كل ٥ ثوانٍ",
  "reading.theme": "سمة القراءة",
  "reading.themeHint": "تعيد طلاء التطبيق كاملًا. اختر «بدون» للإبقاء على لوحة ألوان Zekra.",
  "reading.lightThemes": "السمات الفاتحة",
  "reading.darkThemes": "السمات الداكنة",
  "reading.ownPalette": "استخدام لوحة ألوان Zekra",
  "tree.title": "المستكشف",
  "tree.empty": "لا توجد كيانات في هذا الدماغ بعد.",
  "tree.expand": "توسيع",
  "tree.collapse": "طي",
  "tree.cycle": "يعود إلى عنصر أعلى",
  "tree.deep": "أقصى عمق",
  "tree.noChildren": "لا توجد علاقات صادرة.",
  "action.refresh": "تحديث",
  "action.retry": "إعادة المحاولة",
  "settings.title": "الإعدادات",
  "settings.apiBase": "عنوان الواجهة البرمجية",
  "settings.theme": "السمة",
  "settings.language": "اللغة",
  "settings.signedInAs": "مسجّل الدخول باسم",
  "settings.version": "الإصدار",
  "settings.themeLight": "فاتح",
  "settings.themeDark": "داكن",
  "settings.themeSystem": "النظام",
  "settings.section.general": "عام",
  "settings.section.reading": "القراءة",
  "settings.section.account": "الحساب",
  "settings.section.security": "الأمان",
  "settings.section.about": "حول",
  "settings.checkUpdates": "البحث عن تحديثات",
  "settings.installUpdate": "أعد التشغيل للتحديث",
  "settings.lockSoon": "قفل التطبيق ببصمة Touch ID قادم في تحديث لاحق.",

  "nav.brains": "الأدمغة",
  "nav.search": "البحث",
  "nav.presentations": "العروض",
  "nav.notifications": "الإشعارات",
  "nav.settings": "الإعدادات",
  "nav.back": "رجوع",
  "nav.primary": "التنقل الرئيسي",

  "shell.search": "ابحث أو انتقل إلى…",
  "shell.account": "الحساب",
  "shell.signedOut": "غير مسجّل الدخول",
  "shell.online": "متصل",
  "shell.offline": "غير متصل",
  "shell.noBrain": "لا يوجد دماغ مفتوح",
  "shell.comingSoon": "قريبًا",
  "shell.comingSoonBody": "هذا الجزء من ذكرة لنظام Mac قيد البناء.",
  "shell.openedFile": "تم فتح {name}",
  "shell.signInLink": "جارٍ إكمال تسجيل الدخول…",
  "status.words": "كلمة",
  "about.title": "حول ذكرة",
};

// Mobile features first, desktop over them (see the header comment).
const DICTS: Record<LocaleId, Record<string, string>> = {
  en: Object.assign(
    {},
    ...FEATURE_DICTS.map((d) => d.en as Record<string, string>),
    ...DESKTOP_FEATURE_DICTS.map((d) => d.en as Record<string, string>),
    en,
  ),
  ar: Object.assign(
    {},
    ...FEATURE_DICTS.map((d) => d.ar as Record<string, string>),
    ...DESKTOP_FEATURE_DICTS.map((d) => d.ar as Record<string, string>),
    ar,
  ),
};

export type TVars = Record<string, string | number>;

function translate(locale: LocaleId, key: TKey, vars?: TVars): string {
  const raw = DICTS[locale][key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

type I18nValue = {
  locale: LocaleId;
  isRtl: boolean;
  dir: "ltr" | "rtl";
  t: (key: TKey, vars?: TVars) => string;
  setLocale: (locale: LocaleId) => void;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  isRtl: false,
  dir: "ltr",
  t: (k, vars) => translate("en", k, vars),
  setLocale: () => {},
});

export function I18nProvider({ initial, onChange, children }: {
  initial: LocaleId;
  onChange?: (locale: LocaleId) => void;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<LocaleId>(initial);
  // Follow a locale change made elsewhere (settings reloaded, another window).
  useEffect(() => setLocaleState(initial), [initial]);

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
    dir: locale === "ar" ? "rtl" : "ltr",
    t: (key: TKey, vars?: TVars) => translate(locale, key, vars),
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);
