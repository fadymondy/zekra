import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import type { ServicesInfo, SyncConflict, SyncStatus } from "../../../shared/ipc";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { clearCache, dismissConflict, syncNow, useSyncStatus } from "../../services/offline";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { Group, Row, Segmented, SettingsHeader } from "./ui";

/*
Settings ▸ Services — the desktop services that live in the main process
(src/main/services.ts): the offline cache + background sync, the Quick
Capture global shortcut, and launch at login. Strings are local (EN/AR) so
this section does not touch the shared dictionaries.

Mount it as its own settings section, or inside another with `embedded`
(no page header).
*/

const STR = {
  en: {
    title: "Services",
    description: "Offline notes, background sync, Quick Capture and startup.",
    sync: "Sync & offline",
    status: "Status",
    online: "Online",
    offline: "Offline — edits are kept and sent when you reconnect",
    syncing: "Syncing…",
    paused: "Paused",
    pausedSuspend: "Paused while the computer sleeps",
    pausedLowPower: "Paused in Low Power Mode",
    pausedThermal: "Paused while the computer is hot",
    signedOut: "Sign in to sync",
    disabled: "Offline copy is off",
    error: "Last sync failed",
    lastSynced: "Last synced {when}",
    never: "Not synced yet",
    pending: "{n} edits waiting to sync",
    pendingOne: "1 edit waiting to sync",
    syncNow: "Sync Now",
    cache: "Keep an offline copy",
    cacheHint: "Brains and notes are stored on this computer, so Zekra opens instantly and works without a connection.",
    every: "Sync in the background",
    everyHint: "Zekra also syncs at launch, when you come back to it, and right after you edit.",
    off: "Off",
    minutes: "{n} min",
    local: "Local copy",
    localHint: "{notes} notes in {brains} brains · {size}",
    clear: "Clear…",
    clearConfirm: "Clear the offline copy?",
    clearDetail: "Notes are downloaded again on the next sync. Edits that have not synced yet are kept.",
    clearOk: "Clear",
    cancel: "Cancel",
    cleared: "Offline copy cleared",
    conflicts: "Sync conflicts",
    "conflict.edit-edit": "“{title}” changed here and elsewhere — your version was kept as a copy.",
    "conflict.edit-deleted": "“{title}” was deleted elsewhere — your edits were kept as a new note.",
    "conflict.delete-edited": "“{title}” was edited elsewhere, so it was not deleted.",
    "conflict.rejected": "“{title}” could not be saved: {message}",
    dismiss: "Dismiss",
    capture: "Quick Capture",
    shortcut: "Shortcut",
    shortcutHint: "Opens a small panel over any app to capture a note — even offline.",
    record: "Record…",
    recording: "Press the new shortcut…",
    reset: "Default",
    disable: "Turn off",
    none: "Off",
    inUse: "{key} is already used by another app or the system.",
    invalid: "{key} can't be used — include ⌘, ⌃ or ⌥ and one key.",
    openCapture: "Open Quick Capture",
    search: "Search",
    spotShortcut: "Search shortcut",
    spotShortcutHint: "Opens Zekra’s search panel from any app. ⌘K / Ctrl+K works whenever Zekra is in front.",
    openSearch: "Open Search",
    startup: "Startup",
    login: "Open Zekra at login",
    loginHint: "Starts with your computer.",
    hidden: "Start in the menu bar",
    hiddenWin: "Start in the notification area",
    hiddenHint: "Don't open the window; Zekra waits in the menu bar / tray.",
    devBuild: "Development build: the login item is registered only by the installed app.",
  },
  ar: {
    title: "الخدمات",
    description: "الملاحظات دون اتصال، والمزامنة في الخلفية، والالتقاط السريع، وبدء التشغيل.",
    sync: "المزامنة ودون اتصال",
    status: "الحالة",
    online: "متصل",
    offline: "غير متصل — تُحفظ التعديلات وتُرسل عند عودة الاتصال",
    syncing: "جارٍ المزامنة…",
    paused: "متوقفة مؤقتًا",
    pausedSuspend: "متوقفة أثناء سكون الجهاز",
    pausedLowPower: "متوقفة في وضع الطاقة المنخفضة",
    pausedThermal: "متوقفة أثناء ارتفاع حرارة الجهاز",
    signedOut: "سجّل الدخول للمزامنة",
    disabled: "النسخة المحلية متوقفة",
    error: "فشلت آخر مزامنة",
    lastSynced: "آخر مزامنة {when}",
    never: "لم تتم المزامنة بعد",
    pending: "{n} تعديلات بانتظار المزامنة",
    pendingOne: "تعديل واحد بانتظار المزامنة",
    syncNow: "زامن الآن",
    cache: "احتفظ بنسخة دون اتصال",
    cacheHint: "تُخزَّن الأدمغة والملاحظات على هذا الجهاز، فتفتح ذكرة فورًا وتعمل دون اتصال.",
    every: "المزامنة في الخلفية",
    everyHint: "تزامن ذكرة أيضًا عند التشغيل وعند العودة إليها وبعد التعديل مباشرة.",
    off: "إيقاف",
    minutes: "{n} د",
    local: "النسخة المحلية",
    localHint: "{notes} ملاحظة في {brains} دماغ · {size}",
    clear: "مسح…",
    clearConfirm: "مسح النسخة دون اتصال؟",
    clearDetail: "ستُنزَّل الملاحظات مجددًا في المزامنة التالية. تبقى التعديلات التي لم تُزامن.",
    clearOk: "مسح",
    cancel: "إلغاء",
    cleared: "مُسحت النسخة دون اتصال",
    conflicts: "تعارضات المزامنة",
    "conflict.edit-edit": "«{title}» تغيّرت هنا وفي مكان آخر — حُفظت نسختك كنسخة منفصلة.",
    "conflict.edit-deleted": "«{title}» حُذفت في مكان آخر — حُفظت تعديلاتك كملاحظة جديدة.",
    "conflict.delete-edited": "«{title}» عُدّلت في مكان آخر، لذا لم تُحذف.",
    "conflict.rejected": "تعذّر حفظ «{title}»: {message}",
    dismiss: "تجاهل",
    capture: "الالتقاط السريع",
    shortcut: "الاختصار",
    shortcutHint: "يفتح لوحة صغيرة فوق أي تطبيق لالتقاط ملاحظة — حتى دون اتصال.",
    record: "تسجيل…",
    recording: "اضغط الاختصار الجديد…",
    reset: "الافتراضي",
    disable: "إيقاف",
    none: "متوقف",
    inUse: "{key} مستخدم من تطبيق آخر أو من النظام.",
    invalid: "لا يمكن استخدام {key} — أضف ⌘ أو ⌃ أو ⌥ ومفتاحًا واحدًا.",
    openCapture: "افتح الالتقاط السريع",
    search: "البحث",
    spotShortcut: "اختصار البحث",
    spotShortcutHint: "يفتح لوحة بحث ذكرة من أي تطبيق. يعمل ⌘K / Ctrl+K دائمًا عندما تكون ذكرة في المقدمة.",
    openSearch: "افتح البحث",
    startup: "بدء التشغيل",
    login: "افتح ذكرة عند تسجيل الدخول",
    loginHint: "تبدأ مع تشغيل الجهاز.",
    hidden: "ابدأ في شريط القوائم",
    hiddenWin: "ابدأ في منطقة الإشعارات",
    hiddenHint: "لا تفتح النافذة؛ تنتظر ذكرة في شريط القوائم.",
    devBuild: "نسخة تطوير: يُسجَّل عنصر تسجيل الدخول في التطبيق المثبّت فقط.",
  },
} as const;

type Key = keyof (typeof STR)["en"];

function fmt(s: string, vars: Record<string, string | number> = {}): string {
  return s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

function bytes(n = 0): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function relative(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(Math.round(s), "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

/* ------------------------------------------------------ accelerators */

const CODE_KEYS: Record<string, string> = {
  Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Escape: "Escape",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
};

/** An Electron accelerator from a key event (by physical key, so ⌥ does not
 *  turn N into ˜). Null while only modifiers are held. */
export function acceleratorFromEvent(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, mac: boolean): string | null {
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) key = e.code;
  else key = CODE_KEYS[e.code];
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push(mac ? "Command" : "Super");
  return [...mods, key].join("+");
}

export function displayAccelerator(accel: string, mac: boolean): string {
  if (!accel) return "";
  const parts = accel.split("+");
  const key = parts.pop()!;
  if (mac) {
    const sym: Record<string, string> = { Control: "⌃", Ctrl: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧", Command: "⌘", Cmd: "⌘", CommandOrControl: "⌘", CmdOrCtrl: "⌘" };
    const order = ["⌃", "⌥", "⇧", "⌘"];
    return parts.map((p) => sym[p] ?? p).sort((a, b) => order.indexOf(a) - order.indexOf(b)).join("") + key;
  }
  const name: Record<string, string> = { Control: "Ctrl", CommandOrControl: "Ctrl", CmdOrCtrl: "Ctrl", Super: "Win", Meta: "Win", Command: "Win" };
  return [...parts.map((p) => name[p] ?? p), key].join("+");
}

/* ------------------------------------------------------------ section */

export function ServicesSettings({ embedded = false }: { embedded?: boolean }) {
  const { locale } = useI18n();
  const t = (k: Key, vars?: Record<string, string | number>) => fmt(STR[locale === "ar" ? "ar" : "en"][k], vars);
  const { settings, patch } = useSession();
  const status = useSyncStatus();
  const [info, setInfo] = useState<ServicesInfo | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingSpot, setRecordingSpot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dev, setDev] = useState(false);
  const available = typeof bridge().getServicesInfo === "function";
  const mac = info ? info.platform === "darwin" : /Mac/i.test(navigator.platform);

  const refresh = useCallback(async () => {
    const next = await bridge().getServicesInfo?.();
    if (next) setInfo(next);
  }, []);
  useEffect(() => {
    void refresh();
    void bridge().getAppInfo().then((a) => setDev(!a.isPackaged), () => undefined);
  }, [refresh]);

  if (!available) return null;

  async function doSync() {
    setBusy(true);
    await syncNow().catch(() => undefined);
    setBusy(false);
  }

  async function doClear() {
    const { response } = await bridge().confirm({
      message: t("clearConfirm"),
      detail: t("clearDetail"),
      buttons: [t("clearOk"), t("cancel")],
      defaultId: 1,
      cancelId: 1,
      type: "warning",
    });
    if (response !== 0) return;
    await clearCache(false);
    toast.success(t("cleared"));
  }

  async function setShortcut(accel: string | null) {
    const res = await bridge().setQuickCaptureShortcut?.(accel);
    setRecording(false);
    if (res && !res.ok) {
      const key = displayAccelerator(res.accelerator, mac);
      toast.error(res.error === "in-use" ? t("inUse", { key }) : t("invalid", { key }));
    }
    await refresh();
  }

  async function setSpotShortcut(accel: string) {
    const res = await bridge().setSpotlightShortcut?.(accel);
    setRecordingSpot(false);
    if (res && !res.ok) {
      const key = displayAccelerator(res.accelerator, mac);
      toast.error(res.error === "in-use" ? t("inUse", { key }) : t("invalid", { key }));
    }
  }

  function onRecordSpotKey(e: ReactKeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setRecordingSpot(false);
      return;
    }
    const accel = acceleratorFromEvent(e.nativeEvent, mac);
    if (accel) void setSpotShortcut(accel);
  }

  function onRecordKey(e: ReactKeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setRecording(false);
      return;
    }
    const accel = acceleratorFromEvent(e.nativeEvent, mac);
    if (accel) void setShortcut(accel);
  }

  const notes = status.namespaces.reduce((n, b) => n + b.notes, 0);
  const shortcut = info?.quickCaptureShortcut ?? "";

  return (
    <>
      {embedded ? null : <SettingsHeader title={t("title")} description={t("description")} />}

      <Group title={t("sync")}>
        <Row label={t("status")} hint={<StatusLine status={status} t={t} locale={locale} />}>
          <Button variant="outline" size="sm" onClick={() => void doSync()} disabled={busy || status.state === "syncing" || !status.enabled}>
            {t("syncNow")}
          </Button>
        </Row>
        <Row label={t("cache")} hint={t("cacheHint")}>
          <Switch checked={settings.offlineCacheEnabled} onCheckedChange={(v) => void patch({ offlineCacheEnabled: v })} aria-label={t("cache")} />
        </Row>
        <Row label={t("every")} hint={t("everyHint")}>
          <Segmented<string>
            label={t("every")}
            value={String(settings.syncIntervalMinutes)}
            onChange={(v) => void patch({ syncIntervalMinutes: Number(v) })}
            options={[
              { value: "0", label: t("off") },
              { value: "5", label: t("minutes", { n: 5 }) },
              { value: "15", label: t("minutes", { n: 15 }) },
              { value: "30", label: t("minutes", { n: 30 }) },
            ]}
          />
        </Row>
        <Row label={t("local")} hint={t("localHint", { notes, brains: status.namespaces.length, size: bytes(status.cacheBytes) })}>
          <Button variant="outline" size="sm" onClick={() => void doClear()} disabled={!status.namespaces.length}>
            {t("clear")}
          </Button>
        </Row>
      </Group>

      {status.conflicts.length ? (
        <Group title={t("conflicts")}>
          {status.conflicts.map((c) => (
            <Row key={c.id} label={<ConflictText c={c} t={t} />} hint={relative(c.at, locale) ?? undefined}>
              <Button variant="ghost" size="sm" onClick={() => void dismissConflict(c.id)}>
                {t("dismiss")}
              </Button>
            </Row>
          ))}
        </Group>
      ) : null}

      <Group title={t("capture")}>
        <Row label={t("shortcut")} hint={t("shortcutHint")}>
          {recording ? (
            <button
              type="button"
              autoFocus
              onKeyDown={onRecordKey}
              onBlur={() => setRecording(false)}
              className="h-7 min-w-40 rounded-md border border-primary px-3 text-[13px] text-muted-foreground outline-none ring-2 ring-primary/30"
            >
              {t("recording")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRecording(true)}
              title={t("record")}
              className="h-7 min-w-24 rounded-md border border-border/70 bg-background px-3 font-mono text-[13px] text-foreground hover:bg-hover"
            >
              {shortcut ? displayAccelerator(shortcut, mac) : t("none")}
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void setShortcut(null)} disabled={settings.quickCaptureShortcut === null}>
            {t("reset")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void setShortcut("")} disabled={!shortcut}>
            {t("disable")}
          </Button>
        </Row>
        <Row label={t("openCapture")}>
          <Button variant="outline" size="sm" onClick={() => void bridge().openQuickCapture?.()}>
            {t("openCapture")}
          </Button>
        </Row>
      </Group>

      <Group title={t("search")}>
        <Row label={t("spotShortcut")} hint={t("spotShortcutHint")}>
          {recordingSpot ? (
            <button
              type="button"
              autoFocus
              onKeyDown={onRecordSpotKey}
              onBlur={() => setRecordingSpot(false)}
              className="h-7 min-w-40 rounded-md border border-primary px-3 text-[13px] text-muted-foreground outline-none ring-2 ring-primary/30"
            >
              {t("recording")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRecordingSpot(true)}
              title={t("record")}
              className="h-7 min-w-24 rounded-md border border-border/70 bg-background px-3 font-mono text-[13px] text-foreground hover:bg-hover"
            >
              {settings.spotlightShortcut ? displayAccelerator(settings.spotlightShortcut, mac) : t("none")}
            </button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void setSpotShortcut("")} disabled={!settings.spotlightShortcut}>
            {t("disable")}
          </Button>
        </Row>
        <Row label={t("openSearch")}>
          <Button variant="outline" size="sm" onClick={() => void bridge().openSpotlight?.()}>
            {t("openSearch")}
          </Button>
        </Row>
      </Group>

      <Group title={t("startup")} description={dev ? t("devBuild") : undefined}>
        <Row label={t("login")} hint={t("loginHint")}>
          <Switch
            checked={settings.launchAtLogin}
            onCheckedChange={(v) => void patch({ launchAtLogin: v }).then(refresh)}
            aria-label={t("login")}
          />
        </Row>
        <Row label={mac ? t("hidden") : t("hiddenWin")} hint={t("hiddenHint")}>
          <Switch
            checked={settings.openAtLoginHidden}
            disabled={!settings.launchAtLogin}
            onCheckedChange={(v) => void patch({ openAtLoginHidden: v })}
            aria-label={mac ? t("hidden") : t("hiddenWin")}
          />
        </Row>
      </Group>
    </>
  );
}

function StatusLine({ status, t, locale }: { status: SyncStatus; t: (k: Key, v?: Record<string, string | number>) => string; locale: string }) {
  const state: Record<SyncStatus["state"], Key> = {
    idle: "online",
    syncing: "syncing",
    offline: "offline",
    paused: status.pausedReason === "suspend" ? "pausedSuspend" : status.pausedReason === "low-power" ? "pausedLowPower" : status.pausedReason === "thermal" ? "pausedThermal" : "paused",
    error: "error",
    "signed-out": "signedOut",
    disabled: "disabled",
  };
  const when = relative(status.lastSyncedAt, locale);
  const parts = [t(state[status.state]), when ? t("lastSynced", { when }) : t("never")];
  if (status.pending) parts.push(status.pending === 1 ? t("pendingOne") : t("pending", { n: status.pending }));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={
          "inline-block size-2 shrink-0 rounded-full " +
          (status.state === "idle" ? "bg-emerald-500" : status.state === "syncing" ? "animate-pulse bg-primary" : status.state === "error" ? "bg-destructive" : "bg-muted-foreground/60")
        }
      />
      {parts.join(" · ")}
    </span>
  );
}

function ConflictText({ c, t }: { c: SyncConflict; t: (k: Key, v?: Record<string, string | number>) => string }) {
  return <span>{t(`conflict.${c.kind}` as Key, { title: c.title || "—", message: c.message ?? "" })}</span>;
}
