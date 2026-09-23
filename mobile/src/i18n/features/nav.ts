import { defineDict } from "@/i18n/define";

// Strings owned by the iOS 26 Liquid Glass navigation + native search (MH-360).
// Keys are prefixed "nav." — the base dictionary's nav.brains / nav.search /
// nav.settings stay where they are.
export default defineDict({
  en: {
    "nav.account": "Account",
    "nav.recent": "Recent searches",
    "nav.clearRecent": "Clear",
    "nav.scopeIn": "In {brain}",
    "nav.scopeAll": "Search every brain",
    "nav.browseHint": "Tap a brain to search inside it · long-press to open it",
    "nav.scopeBrain": "Search inside this brain",
    "nav.openBrain": "Long-press to open the brain",
    "nav.rerun": "Search again",
    "nav.liveHint": "Results appear as you type.",
    "nav.resultCount": "{count} results",
    "nav.updating": "Updating results",
  },
  ar: {
    "nav.account": "الحساب",
    "nav.recent": "عمليات البحث الأخيرة",
    "nav.clearRecent": "مسح",
    "nav.scopeIn": "في {brain}",
    "nav.scopeAll": "ابحث في كل الأدمغة",
    "nav.browseHint": "اضغط على دماغ للبحث داخله · اضغط مطولًا لفتحه",
    "nav.scopeBrain": "البحث داخل هذا الدماغ",
    "nav.openBrain": "اضغط مطولًا لفتح الدماغ",
    "nav.rerun": "ابحث مجددًا",
    "nav.liveHint": "تظهر النتائج أثناء الكتابة.",
    "nav.resultCount": "{count} نتيجة",
    "nav.updating": "جارٍ تحديث النتائج",
  },
});
