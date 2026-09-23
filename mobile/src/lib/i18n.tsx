import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { I18nManager, Platform } from "react-native";

import { FEATURE_DICTS, type FeatureKey } from "@/i18n/features";
import { getStored, setStored } from "@/lib/storage";
import { setUiFontLocale } from "@/theme";

// Zekra ships bilingual everywhere (mirroring web/lib/i18n.tsx). The Arabic
// product name is ذكرة — never ذكرى.
export type Locale = "en" | "ar";

const en = {
  "app.name": "Zekra",
  "app.tagline": "Your notes, brains, and connected knowledge — carried with you.",

  "nav.notes": "Notes",
  "nav.search": "Search",
  "nav.brains": "Brains",
  "nav.settings": "Settings",

  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.loading": "Loading",
  "common.untitled": "Untitled",
  "common.readOnly": "You have read-only access to this brain.",

  "auth.welcome": "Welcome back",
  "auth.createAccount": "Create your account",
  "auth.resetTitle": "Reset your password",
  "auth.twoFactor": "Two-factor check",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.name": "Name",
  "auth.signIn": "Sign in",
  "auth.signUp": "Create account",
  "auth.signOut": "Sign out",
  "auth.forgot": "Forgot your password?",
  "auth.haveAccount": "Already have an account? Sign in",
  "auth.noAccount": "Create an account",
  "auth.sendReset": "Send reset link",
  "auth.resetSent": "If that address has an account, a reset link is on its way.",
  "auth.authCode": "Authenticator code",
  "auth.recoveryCode": "Recovery code",
  "auth.useRecovery": "Use a recovery code",
  "auth.useAuthenticator": "Use authenticator instead",
  "auth.verify": "Verify and continue",
  "auth.startOver": "Start over",
  "auth.secureAccess": "secure access",
  "auth.failed": "Sign in failed",
  "auth.intro": "Your brains, notes and connected knowledge — recalled on your phone.",
  "auth.invalid": "That email and password don't match.",
  "auth.offline": "You're offline. Check your connection and try again.",
  "auth.showPassword": "Show password",
  "auth.hidePassword": "Hide password",
  "auth.noAccountPrompt": "No account yet?",
  "auth.createOne": "Create one",
  "auth.haveAccountPrompt": "Already have an account?",
  "auth.signInLink": "Sign in",
  "auth.resetIntro": "Type your email and we'll send you a link to set a new password.",
  "auth.backToSignIn": "Remembered it? Back to sign in",
  "auth.twoFactorIntro": "Enter the six-digit code from your authenticator app.",
  "auth.recoveryIntro": "Enter one of the recovery codes you saved when you turned on two-factor.",
  "auth.strengthHint": "At least eight characters, with a number.",
  "auth.step": "STEP {n} / {total}",

  "notes.title": "Notes",
  "notes.searchPlaceholder": "Filter by title, text, and tags",
  "notes.empty": "A quiet brain",
  "notes.emptyBody": "Create the first note and Zekra will index it into this brain.",
  "notes.noMatches": "No matches",
  "notes.noMatchesBody": "Try a different search.",
  "notes.loadingMore": "Loading more",
  "notes.chooseBrain": "Choose a brain",
  "notes.chooseBrainBody": "Open Brains to select a knowledge space.",

  "note.insertImage": "Image",
  "note.imageFailed": "Could not add that image",
  "code.copy": "Copy code",
  "row.appearance": "Icon & colour",
  "row.appearanceIcon": "Icon",
  "row.appearanceColor": "Colour",
  "row.appearanceReset": "Reset",
  "reading.title": "Reading",
  "reading.fontSize": "Body text size",
  "reading.smaller": "Smaller",
  "reading.larger": "Larger",
  "reading.theme": "Reading theme",
  "reading.ownPalette": "Zekra palette",
  "row.share": "Share",
  "note.shareFailed": "Could not share this note",
  "row.pin": "Pin",
  "row.unpin": "Unpin",
  "row.archive": "Archive",
  "row.unarchive": "Restore",
  "row.archiveConfirm": "Archive this note?",
  "row.archiveBody": "It leaves your active list. You can restore it from the archived view at any time.",
  "row.unarchiveConfirm": "Restore this note?",
  "row.unarchiveBody": "It returns to your active list.",
  "note.titleLabel": "Title",
  "note.body": "Body / Markdown",
  "note.edit": "Edit",
  "note.preview": "Preview",
  "note.writePlaceholder": "Write what matters…",
  "note.type": "Type",
  "note.tags": "Tags",
  "note.tagsPlaceholder": "idea, work",
  "note.pinned": "Pinned",
  "note.archived": "Archived",
  "note.save": "Save note",
  "note.delete": "Delete note",
  "note.deleteConfirm": "Delete note?",
  "note.deleteBody": "Zekra keeps its version history, but the note will disappear from your active list.",
  "note.conflict": "This note changed elsewhere. Reload it before saving again.",
  "note.indexing": "Indexing into the brain…",
  "note.chunks": "indexed memory chunks",
  "note.loading": "Loading note",
  "note.notFound": "Could not open note",
  "note.nothingYet": "Nothing written yet.",

  "search.title": "Search",
  "search.placeholder": "Ask your brains anything…",
  "search.allBrains": "All brains",
  "search.empty": "No results",
  "search.emptyBody": "Try different words — search reads meaning, not just keywords.",
  "search.start": "Search your memory",
  "search.startBody": "Type a question or a few words and Zekra will find what it knows.",
  "search.results": "results",
  "search.searching": "Searching",
  "search.failed": "Search failed",
  "search.thisBrain": "This brain",
  "search.resultsLabel": "Results",
  "search.clear": "Clear",
  "search.go": "Search",
  "search.score": "Score",
  "search.openNote": "Open note",
  "search.hint": "Search reads meaning, not just keywords — ask the way you would ask a colleague.",

  "brains.title": "Brains",
  "brains.empty": "No brains yet",
  "brains.emptyBody": "Create a brain to start remembering.",
  "brains.create": "Create brain",
  "brains.namespace": "Namespace",
  "brains.displayName": "Display name",
  "brains.memories": "memories",
  "brains.loading": "Loading brains",
  "brains.failed": "Could not load brains",

  "vault.title": "Vault",
  "vault.empty": "No secrets stored in this brain.",
  "vault.add": "Add secret",
  "vault.name": "Name",
  "vault.value": "Value",
  "vault.saved": "Secret saved",
  "vault.loading": "Opening vault",


  "account.profile": "Profile",
  "account.password": "Password",
  "account.delete": "Delete account",
  "account.name": "Display name",
  "account.timezone": "Timezone",
  "account.saved": "Saved",
  "account.saveProfile": "Save profile",
  "account.passwordBody": "We email you a secure link to set a new password. The link expires shortly after it is sent.",
  "account.sendPasswordLink": "Email me a reset link",
  "account.passwordSent": "Check your inbox for the reset link.",
  "account.deleteWarn": "This schedules your account and every brain you own for permanent deletion. Confirm with your password.",
  "account.deleteConfirm": "Delete my account",
  "account.deleteScheduled": "Deletion scheduled",
  "account.deleteScheduledBody": "Your account is scheduled for deletion. You can still cancel it below.",
  "account.cancelDelete": "Cancel deletion",
  "account.currentPassword": "Your password",
  "account.email": "Email",
  "account.sentTo": "The link goes to",
  "account.deleteWhat": "What happens",
  "account.deleteScheduledFor": "Scheduled for",
  "account.deleteFailed": "Could not schedule the deletion",
  "account.cancelFailed": "Could not cancel the deletion",
  "account.saveFailed": "Could not save your profile",
  "account.linkFailed": "Could not send the link",

  "legal.privacy": "Privacy policy",
  "legal.terms": "Terms of service",
  "legal.support": "Support",
  "legal.openInBrowser": "Open in browser",
  "legal.supportBody": "Questions, bug reports, or data requests — we answer from the address below.",
  "legal.intro": "Published on zekra.dev and kept in step with the App Store and Google Play listings.",
  "legal.email": "Email support",
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.theme": "Theme",
  "settings.themeSystem": "System",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.language": "Language",
  "settings.account": "Account",
  "settings.signedInAs": "Signed in as",
  "settings.activeBrain": "Active brain",
  "settings.none": "None selected",
  "settings.api": "API",
  "settings.version": "App version",
  "settings.mcp": "MCP connection",
  "settings.mcpBody": "Connect an AI agent to this brain over the Model Context Protocol.",
  "settings.mcpUrl": "Server URL",
  "settings.mcpAuth": "Auth",
  "settings.mcpAuthValue": "OAuth 2.1 — sign in with your Zekra account",
  "settings.copied": "Copied",
  "settings.openConsole": "Open web console",
  "settings.sessionNote": "Your session stays on this device",
  "settings.sessionBody": "The access token is stored in the iOS Keychain or Android Keystore through Expo SecureStore.",
  "settings.legal": "Legal",
  "settings.connect": "Connect an agent",
  "settings.copy": "Copy",
} as const;

type Key = keyof typeof en;

const ar: Record<Key, string> = {
  "app.name": "ذكرة",
  "app.tagline": "ملاحظاتك وأدمغتك ومعرفتك المترابطة — معك أينما كنت.",

  "nav.notes": "الملاحظات",
  "nav.search": "البحث",
  "nav.brains": "الأدمغة",
  "nav.settings": "الإعدادات",

  "common.cancel": "إلغاء",
  "common.save": "حفظ",
  "common.delete": "حذف",
  "common.close": "إغلاق",
  "common.loading": "جارٍ التحميل",
  "common.untitled": "بدون عنوان",
  "common.readOnly": "لديك صلاحية قراءة فقط في هذا الدماغ.",

  "auth.welcome": "أهلًا بعودتك",
  "auth.createAccount": "أنشئ حسابك",
  "auth.resetTitle": "إعادة تعيين كلمة المرور",
  "auth.twoFactor": "التحقق بخطوتين",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.name": "الاسم",
  "auth.signIn": "تسجيل الدخول",
  "auth.signUp": "إنشاء حساب",
  "auth.signOut": "تسجيل الخروج",
  "auth.forgot": "نسيت كلمة المرور؟",
  "auth.haveAccount": "لديك حساب بالفعل؟ سجّل الدخول",
  "auth.noAccount": "إنشاء حساب",
  "auth.sendReset": "إرسال رابط الاستعادة",
  "auth.resetSent": "إن كان لهذا العنوان حساب، فرابط الاستعادة في طريقه إليك.",
  "auth.authCode": "رمز المصادقة",
  "auth.recoveryCode": "رمز الاسترداد",
  "auth.useRecovery": "استخدم رمز استرداد",
  "auth.useAuthenticator": "استخدم تطبيق المصادقة",
  "auth.verify": "تحقّق وتابع",
  "auth.startOver": "البدء من جديد",
  "auth.secureAccess": "دخول آمن",
  "auth.failed": "فشل تسجيل الدخول",
  "auth.intro": "أدمغتك وملاحظاتك ومعرفتك المترابطة — تسترجعها من هاتفك.",
  "auth.invalid": "البريد الإلكتروني وكلمة المرور غير متطابقين.",
  "auth.offline": "أنت غير متصل. تحقّق من اتصالك وأعد المحاولة.",
  "auth.showPassword": "إظهار كلمة المرور",
  "auth.hidePassword": "إخفاء كلمة المرور",
  "auth.noAccountPrompt": "ليس لديك حساب؟",
  "auth.createOne": "أنشئ واحدًا",
  "auth.haveAccountPrompt": "لديك حساب بالفعل؟",
  "auth.signInLink": "سجّل الدخول",
  "auth.resetIntro": "اكتب بريدك وسنرسل إليك رابطًا لتعيين كلمة مرور جديدة.",
  "auth.backToSignIn": "تذكّرت كلمة المرور؟ عُد للدخول",
  "auth.twoFactorIntro": "اكتب الرمز المكوّن من ستّ خانات الظاهر في تطبيق المصادقة.",
  "auth.recoveryIntro": "اكتب أحد رموز الاسترداد التي حفظتها عند تفعيل التحقق بخطوتين.",
  "auth.strengthHint": "ثمانية أحرف على الأقل، ورقم واحد.",
  "auth.step": "STEP {n} / {total}",

  "notes.title": "الملاحظات",
  "notes.searchPlaceholder": "تصفية بالعنوان والنص والوسوم",
  "notes.empty": "دماغ هادئ",
  "notes.emptyBody": "أنشئ أول ملاحظة وستقوم ذكرة بفهرستها في هذا الدماغ.",
  "notes.noMatches": "لا نتائج",
  "notes.noMatchesBody": "جرّب بحثًا مختلفًا.",
  "notes.loadingMore": "جارٍ تحميل المزيد",
  "notes.chooseBrain": "اختر دماغًا",
  "notes.chooseBrainBody": "افتح الأدمغة لاختيار مساحة معرفية.",

  "note.insertImage": "صورة",
  "note.imageFailed": "تعذّر إضافة الصورة",
  "code.copy": "نسخ الشيفرة",
  "row.appearance": "الأيقونة واللون",

  "row.appearanceIcon": "الأيقونة",

  "row.appearanceColor": "اللون",

  "row.appearanceReset": "إعادة تعيين",
  "reading.title": "القراءة",
  "reading.fontSize": "حجم نص المتن",
  "reading.smaller": "أصغر",
  "reading.larger": "أكبر",
  "reading.theme": "سمة القراءة",
  "reading.ownPalette": "لوحة Zekra",
  "row.share": "مشاركة",
  "note.shareFailed": "تعذّرت مشاركة هذه الملاحظة",

  "row.pin": "تثبيت",
  "row.unpin": "إلغاء التثبيت",
  "row.archive": "أرشفة",
  "row.unarchive": "استعادة",
  "row.archiveConfirm": "أرشفة هذه الملاحظة؟",
  "row.archiveBody": "ستغادر قائمتك النشطة. يمكنك استعادتها من عرض المؤرشفة في أي وقت.",
  "row.unarchiveConfirm": "استعادة هذه الملاحظة؟",
  "row.unarchiveBody": "ستعود إلى قائمتك النشطة.",
  "note.titleLabel": "العنوان",
  "note.body": "النص / ماركداون",
  "note.edit": "تحرير",
  "note.preview": "معاينة",
  "note.writePlaceholder": "اكتب ما يهم…",
  "note.type": "النوع",
  "note.tags": "الوسوم",
  "note.tagsPlaceholder": "فكرة، عمل",
  "note.pinned": "مثبّتة",
  "note.archived": "مؤرشفة",
  "note.save": "حفظ الملاحظة",
  "note.delete": "حذف الملاحظة",
  "note.deleteConfirm": "حذف الملاحظة؟",
  "note.deleteBody": "تحتفظ ذكرة بسجل الإصدارات، لكن الملاحظة ستختفي من قائمتك النشطة.",
  "note.conflict": "تغيّرت هذه الملاحظة في مكان آخر. أعد تحميلها قبل الحفظ.",
  "note.indexing": "جارٍ الفهرسة في الدماغ…",
  "note.chunks": "مقاطع ذاكرة مفهرسة",
  "note.loading": "جارٍ تحميل الملاحظة",
  "note.notFound": "تعذّر فتح الملاحظة",
  "note.nothingYet": "لا يوجد محتوى بعد.",

  "search.title": "البحث",
  "search.placeholder": "اسأل أدمغتك عن أي شيء…",
  "search.allBrains": "كل الأدمغة",
  "search.empty": "لا نتائج",
  "search.emptyBody": "جرّب كلمات أخرى — البحث يقرأ المعنى لا الكلمات فقط.",
  "search.start": "ابحث في ذاكرتك",
  "search.startBody": "اكتب سؤالًا أو بضع كلمات وستجد ذكرة ما تعرفه.",
  "search.results": "نتيجة",
  "search.searching": "جارٍ البحث",
  "search.failed": "فشل البحث",
  "search.thisBrain": "هذا الدماغ",
  "search.resultsLabel": "النتائج",
  "search.clear": "مسح",
  "search.go": "ابحث",
  "search.score": "الدرجة",
  "search.openNote": "فتح الملاحظة",
  "search.hint": "البحث يقرأ المعنى لا الكلمات فقط — اسأل كما تسأل زميلًا.",

  "brains.title": "الأدمغة",
  "brains.empty": "لا توجد أدمغة بعد",
  "brains.emptyBody": "أنشئ دماغًا لتبدأ التذكّر.",
  "brains.create": "إنشاء دماغ",
  "brains.namespace": "المعرّف",
  "brains.displayName": "الاسم المعروض",
  "brains.memories": "ذكرى",
  "brains.loading": "جارٍ تحميل الأدمغة",
  "brains.failed": "تعذّر تحميل الأدمغة",

  "vault.title": "الخزنة",
  "vault.empty": "لا توجد أسرار في هذا الدماغ.",
  "vault.add": "إضافة سر",
  "vault.name": "الاسم",
  "vault.value": "القيمة",
  "vault.saved": "تم حفظ السر",
  "vault.loading": "جارٍ فتح الخزنة",


  "account.profile": "الملف الشخصي",
  "account.password": "كلمة المرور",
  "account.delete": "حذف الحساب",
  "account.name": "الاسم المعروض",
  "account.timezone": "المنطقة الزمنية",
  "account.saved": "تم الحفظ",
  "account.saveProfile": "حفظ الملف",
  "account.passwordBody": "نرسل إليك رابطًا آمنًا لتعيين كلمة مرور جديدة. تنتهي صلاحية الرابط بعد وقت قصير.",
  "account.sendPasswordLink": "أرسل لي رابط الاستعادة",
  "account.passwordSent": "تحقّق من بريدك للحصول على الرابط.",
  "account.deleteWarn": "سيؤدي هذا إلى جدولة حسابك وكل أدمغتك للحذف النهائي. أكّد بكلمة المرور.",
  "account.deleteConfirm": "احذف حسابي",
  "account.deleteScheduled": "تمت جدولة الحذف",
  "account.deleteScheduledBody": "حسابك مجدول للحذف. لا يزال بإمكانك الإلغاء أدناه.",
  "account.cancelDelete": "إلغاء الحذف",
  "account.currentPassword": "كلمة المرور",
  "account.email": "البريد الإلكتروني",
  "account.sentTo": "يُرسل الرابط إلى",
  "account.deleteWhat": "ماذا يحدث",
  "account.deleteScheduledFor": "موعد الحذف",
  "account.deleteFailed": "تعذّرت جدولة الحذف",
  "account.cancelFailed": "تعذّر إلغاء الحذف",
  "account.saveFailed": "تعذّر حفظ ملفك الشخصي",
  "account.linkFailed": "تعذّر إرسال الرابط",

  "legal.privacy": "سياسة الخصوصية",
  "legal.terms": "شروط الخدمة",
  "legal.support": "الدعم",
  "legal.openInBrowser": "فتح في المتصفح",
  "legal.supportBody": "أسئلة أو بلاغات أو طلبات بيانات — نجيب من العنوان أدناه.",
  "legal.intro": "منشورة على zekra.dev ومتوافقة مع صفحتَي التطبيق في App Store وGoogle Play.",
  "legal.email": "راسل الدعم",
  "settings.title": "الإعدادات",
  "settings.appearance": "المظهر",
  "settings.theme": "السمة",
  "settings.themeSystem": "النظام",
  "settings.themeLight": "فاتح",
  "settings.themeDark": "داكن",
  "settings.language": "اللغة",
  "settings.account": "الحساب",
  "settings.signedInAs": "مسجّل الدخول باسم",
  "settings.activeBrain": "الدماغ النشط",
  "settings.none": "لم يُختر",
  "settings.api": "الواجهة البرمجية",
  "settings.version": "إصدار التطبيق",
  "settings.mcp": "اتصال MCP",
  "settings.mcpBody": "اربط وكيل ذكاء اصطناعي بهذا الدماغ عبر بروتوكول MCP.",
  "settings.mcpUrl": "عنوان الخادم",
  "settings.mcpAuth": "المصادقة",
  "settings.mcpAuthValue": "OAuth 2.1 — سجّل الدخول بحساب ذكرة",
  "settings.copied": "تم النسخ",
  "settings.openConsole": "فتح لوحة الويب",
  "settings.sessionNote": "جلستك تبقى على هذا الجهاز",
  "settings.sessionBody": "يُخزَّن رمز الوصول في سلسلة مفاتيح iOS أو مخزن مفاتيح Android عبر Expo SecureStore.",
  "settings.legal": "قانوني",
  "settings.connect": "اربط وكيلًا",
  "settings.copy": "نسخ",
};

// Feature dictionaries (src/i18n/features/*) merge over the base one.
const DICTS: Record<Locale, Record<string, string>> = {
  en: Object.assign({}, en, ...FEATURE_DICTS.map((d) => d.en)),
  ar: Object.assign({}, ar, ...FEATURE_DICTS.map((d) => d.ar)),
};

export type TKey = Key | FeatureKey;
export type TVars = Record<string, string | number>;

/** Look up a string and fill `{name}` placeholders. */
export function translate(locale: Locale, key: TKey, vars?: TVars): string {
  const raw = DICTS[locale][key] ?? DICTS.en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : raw;
}

/** Native layout direction. The root view also sets `direction`, so the UI
 *  flips at once; this keeps I18nManager (swipe gestures, stack slide
 *  direction, native alerts) in step from the next launch on. */
function applyNativeDirection(locale: Locale) {
  if (Platform.OS === "web") return;
  const rtl = locale === "ar";
  I18nManager.allowRTL(rtl);
  if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
}
const STORE_KEY = "zekra.locale";

type I18nValue = {
  locale: Locale;
  isRtl: boolean;
  t: (key: TKey, vars?: TVars) => string;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nValue>({
  locale: "en",
  isRtl: false,
  t: (key, vars) => translate("en", key, vars),
  setLocale: () => {},
});

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    void (async () => {
      try {
        const saved = await getStored(STORE_KEY);
        if (saved === "ar" || saved === "en") {
          setLocaleState(saved);
          applyNativeDirection(saved);
        }
      } catch {}
    })();
  }, []);

  // Web: mirror the document. Native: Yoga handles it from Screen's direction.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc?.documentElement) return;
    doc.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    doc.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    applyNativeDirection(next);
    void setStored(STORE_KEY, next);
  }, []);

  // The UI face follows the language (Inter / Lusail); set before children render.
  setUiFontLocale(locale);

  const value = useMemo<I18nValue>(() => ({
    locale,
    isRtl: locale === "ar",
    t: (key: TKey, vars?: TVars) => translate(locale, key, vars),
    setLocale,
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
