import { defineDict } from "@mobile/i18n/define";

/*
Desktop strings for Presentations, the Vault and the Touch ID app lock
(MH-450). Mobile's feature dictionaries carry almost everything
(presentations.*, vault.*, security.*, lock.*, kit.*) and are reused as they
are; this file holds only what is desktop-specific (Touch ID wording, the
split view, saving files, the native-confirm fallback). Keys are prefixed
"desk." so they can never collide with a mobile key.
*/
export default defineDict({
  en: {
    // presentations
    "desk.pres.select": "Select a presentation to see it here.",
    "desk.pres.count": "{n} presentations",
    "desk.pres.readOnly": "You have read-only access to this brain.",
    "desk.pres.fullScreen": "Full screen",
    "desk.pres.previewEmpty": "There's no content in this language yet.",
    "desk.pres.previewLanguage": "Preview language",
    "desk.pres.previewHelp": "Rendered here from the presentation itself, so previewing never counts as a view on a customer's link.",
    "desk.pres.save": "Save…",
    "desk.pres.savedTo": "Saved {name}",
    "desk.pres.openedInBrowser": "This link's files can't be downloaded here, so it opened in your browser.",
    "desk.pres.close": "Close presentation",
    "desk.pres.copyUrl": "Copy link",
    // vault
    "desk.vault.more": "More actions for {name}",
    "desk.vault.confirmTitle": "Reveal {name}?",
    "desk.vault.confirmBody": "Touch ID isn't available on this Mac, so confirm here. The value hides again after 30 seconds or when you leave Zekra.",
    "desk.vault.confirmCopyBody": "Touch ID isn't available on this Mac, so confirm here. The clipboard is cleared after a minute.",
    "desk.vault.readOnly": "You have read-only access to this brain.",
    "desk.vault.copiedWipe": "Secret copied. The clipboard is cleared in a minute.",
    // app lock
    "desk.lock.touchId": "Touch ID",
    "desk.lock.unlockBody": "Zekra asks for Touch ID when it opens and after it has been in the background, and hides your notes until you unlock.",
    "desk.lock.requireAfterBody": "How long Zekra can stay in the background before it locks again. Locking the Mac or putting it to sleep locks Zekra straight away.",
    "desk.lock.noTouchId": "This Mac has no Touch ID (or none is set up), so the app lock isn't available. Set up Touch ID in System Settings to turn it on.",
    "desk.lock.unavailableNow": "Touch ID isn't available right now — for example, the lid is closed. Open the lid and try again, or sign out.",
    "desk.lock.tryAgain": "Try again",
    "desk.lock.lockNow": "Lock now",
    "desk.lock.statusOn": "On · locks after {after}",
    "desk.lock.statusOff": "Off",
  },
  ar: {
    // presentations
    "desk.pres.select": "اختر عرضًا لتراه هنا.",
    "desk.pres.count": "{n} عروض",
    "desk.pres.readOnly": "لديك صلاحية قراءة فقط في هذا الدماغ.",
    "desk.pres.fullScreen": "ملء الشاشة",
    "desk.pres.previewEmpty": "لا يوجد محتوى بهذه اللغة بعد.",
    "desk.pres.previewLanguage": "لغة المعاينة",
    "desk.pres.previewHelp": "يُعرض هنا من العرض نفسه، لذا لا تُحتسب المعاينة مشاهدةً على رابط العميل.",
    "desk.pres.save": "حفظ…",
    "desk.pres.savedTo": "تم حفظ {name}",
    "desk.pres.openedInBrowser": "لا يمكن تنزيل ملفات هذا الرابط هنا، لذا فُتح في المتصفح.",
    "desk.pres.close": "إغلاق العرض",
    "desk.pres.copyUrl": "نسخ الرابط",
    // vault
    "desk.vault.more": "إجراءات أخرى لـ {name}",
    "desk.vault.confirmTitle": "كشف {name}؟",
    "desk.vault.confirmBody": "بصمة Touch ID غير متاحة على هذا الجهاز، لذا أكّد هنا. تختفي القيمة بعد 30 ثانية أو عند مغادرة ذكرة.",
    "desk.vault.confirmCopyBody": "بصمة Touch ID غير متاحة على هذا الجهاز، لذا أكّد هنا. تُمسح الحافظة بعد دقيقة.",
    "desk.vault.readOnly": "لديك صلاحية قراءة فقط في هذا الدماغ.",
    "desk.vault.copiedWipe": "تم نسخ السر. تُمسح الحافظة خلال دقيقة.",
    // app lock
    "desk.lock.touchId": "Touch ID",
    "desk.lock.unlockBody": "تطلب ذكرة بصمة Touch ID عند فتحها وبعد بقائها في الخلفية، وتخفي ملاحظاتك حتى تفتح القفل.",
    "desk.lock.requireAfterBody": "المدة التي يمكن أن تبقى فيها ذكرة في الخلفية قبل أن تُقفل مجددًا. قفل شاشة الجهاز أو إدخاله في وضع السكون يُقفل ذكرة فورًا.",
    "desk.lock.noTouchId": "لا يحتوي هذا الجهاز على Touch ID (أو لم يُفعَّل)، لذا قفل التطبيق غير متاح. فعّل Touch ID من إعدادات النظام لتشغيله.",
    "desk.lock.unavailableNow": "بصمة Touch ID غير متاحة الآن — مثلًا عندما يكون الغطاء مغلقًا. افتح الغطاء وحاول مجددًا، أو سجّل الخروج.",
    "desk.lock.tryAgain": "حاول مجددًا",
    "desk.lock.lockNow": "اقفل الآن",
    "desk.lock.statusOn": "مفعّل · يُقفل بعد {after}",
    "desk.lock.statusOff": "متوقف",
  },
});
