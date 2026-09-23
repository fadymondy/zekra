import { defineDict } from "@/i18n/define";

// Strings owned by the settings pages (src/features/settings, app/settings/*).
export default defineDict({
  en: {
    "settings.x.sections": "Settings sections",
    "settings.x.preferences": "Preferences",
    "settings.x.reading": "Reading",
    "settings.x.notifications": "Notifications",
    "settings.x.connect": "Connect",
    "settings.x.about": "About",
    "settings.x.readingOwn": "Zekra palette",
    "settings.x.readingDetail": "{theme} · {size}px",
    "settings.x.connectDetail": "MCP server and web console",
    "settings.x.aboutDetail": "Privacy, terms, support · v{version}",
    "settings.x.themeBody": "System follows your phone's light or dark setting.",
    "settings.x.languageBody": "Arabic mirrors the whole app, right to left.",
    "settings.x.readingBody": "The reading theme repaints the whole app, like the web console. Type settings apply to notes.",
    "settings.x.notificationsBody": "Zekra only asks for permission when you turn notifications on here.",
  },
  ar: {
    "settings.x.sections": "أقسام الإعدادات",
    "settings.x.preferences": "التفضيلات",
    "settings.x.reading": "القراءة",
    "settings.x.notifications": "الإشعارات",
    "settings.x.connect": "الاتصال",
    "settings.x.about": "حول التطبيق",
    "settings.x.readingOwn": "ألوان ذكرة",
    "settings.x.readingDetail": "{theme} · {size} بكسل",
    "settings.x.connectDetail": "خادم MCP ولوحة الويب",
    "settings.x.aboutDetail": "الخصوصية، الشروط، الدعم · الإصدار {version}",
    "settings.x.themeBody": "يتبع خيار النظام الوضع الفاتح أو الداكن في هاتفك.",
    "settings.x.languageBody": "العربية تقلب التطبيق كله من اليمين إلى اليسار.",
    "settings.x.readingBody": "سمة القراءة تعيد تلوين التطبيق كله كما في لوحة الويب. إعدادات الخط تنطبق على الملاحظات.",
    "settings.x.notificationsBody": "لا تطلب ذكرة الإذن إلا عند تشغيل الإشعارات من هنا.",
  },
});
