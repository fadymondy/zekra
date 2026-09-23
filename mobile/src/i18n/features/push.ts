import { defineDict } from "@/i18n/define";

// Strings owned by the push feature (MH-373). Keys are prefixed "push." to stay unique.
export default defineDict({
  en: {
    "push.title": "Notifications",
    "push.onBody": "On for this device.",
    "push.offBody": "Hear when a brain is shared with you or a presentation you shared is opened.",
    "push.deniedBody": "Blocked in your phone's settings.",
    "push.unavailable": "Not available in this build.",
    "push.openSettings": "Open settings",
    "push.deniedToast": "Allow notifications for Zekra in Settings.",
    "push.enabledToast": "Notifications on",
    "push.failed": "Could not change notifications. Try again.",
    "push.sendTest": "Send a test notification",
    "push.testSent": "Test sent to {count} device(s)",
    "push.testFailed": "The test notification could not be sent.",
    "push.bannerHint": "Opens what the notification is about",
    "push.dismiss": "Dismiss",
  },
  ar: {
    "push.title": "الإشعارات",
    "push.onBody": "مفعّلة على هذا الجهاز.",
    "push.offBody": "تلقَّ تنبيهًا عند مشاركة دماغ معك أو فتح عرض شاركته.",
    "push.deniedBody": "محظورة من إعدادات الهاتف.",
    "push.unavailable": "غير متاحة في هذا الإصدار.",
    "push.openSettings": "فتح الإعدادات",
    "push.deniedToast": "اسمح بإشعارات ذكرة من الإعدادات.",
    "push.enabledToast": "تم تفعيل الإشعارات",
    "push.failed": "تعذّر تغيير الإشعارات. حاول مجددًا.",
    "push.sendTest": "إرسال إشعار تجريبي",
    "push.testSent": "أُرسل الإشعار إلى {count} جهاز",
    "push.testFailed": "تعذّر إرسال الإشعار التجريبي.",
    "push.bannerHint": "يفتح موضوع الإشعار",
    "push.dismiss": "إغلاق",
  },
});
