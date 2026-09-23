import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createRoot } from "react-dom/client";

import type { CaptureInit } from "../../shared/ipc";
import { installAppearanceSync } from "../lib/appearance";

/*
Quick Capture panel — its own tiny renderer entry (no router, no session, no
shadcn), so it loads fast and stays light. Main (src/main/quick-capture.ts)
re-shows the same window each time and sends `evCaptureShow` with the brains,
the last-used brain, theme, locale and platform.

  ⌘↵ / Ctrl+Enter   save (through the offline queue — works offline)
  Esc               dismiss (the draft is kept for next time)
  Clipboard         append the clipboard (a URL becomes a link)
  From browser      the active tab of the browser you came from (macOS)
*/

const STR = {
  en: {
    heading: "Quick Capture",
    title: "Title",
    body: "Capture a thought, a link, a snippet…",
    tags: "Tags, comma separated",
    brain: "Brain",
    save: "Save",
    clipboard: "Clipboard",
    browser: "From browser",
    saved: "Saved",
    savedOffline: "Saved — will sync when you're online",
    offline: "Offline",
    signedOut: "Sign in to Zekra to capture notes.",
    noBrains: "No brain you can write to yet.",
    empty: "Write something first.",
    failed: "Could not save",
    denied: "Allow Zekra to control your browser: System Settings ▸ Privacy & Security ▸ Automation.",
    noBrowser: "Switch to Safari, Chrome, Edge, Brave or Arc first — then press the shortcut.",
    unsupported: "Not available on this system — copy the URL and use Clipboard.",
    clipboardEmpty: "The clipboard is empty.",
    hint: "to save · Esc to close",
  },
  ar: {
    heading: "التقاط سريع",
    title: "العنوان",
    body: "التقط فكرة أو رابطًا أو مقتطفًا…",
    tags: "وسوم، مفصولة بفواصل",
    brain: "الدماغ",
    save: "حفظ",
    clipboard: "الحافظة",
    browser: "من المتصفح",
    saved: "تم الحفظ",
    savedOffline: "تم الحفظ — ستتم المزامنة عند الاتصال",
    offline: "غير متصل",
    signedOut: "سجّل الدخول إلى ذكرة لالتقاط الملاحظات.",
    noBrains: "لا يوجد دماغ يمكنك الكتابة فيه بعد.",
    empty: "اكتب شيئًا أولًا.",
    failed: "تعذّر الحفظ",
    denied: "اسمح لذكرة بالتحكم في المتصفح: إعدادات النظام ▸ الخصوصية والأمان ▸ الأتمتة.",
    noBrowser: "انتقل إلى Safari أو Chrome أو Edge أو Brave أو Arc أولًا ثم اضغط الاختصار.",
    unsupported: "غير متاح على هذا النظام — انسخ الرابط واستخدم الحافظة.",
    clipboardEmpty: "الحافظة فارغة.",
    hint: "للحفظ · Esc للإغلاق",
  },
} as const;

type Strings = { [K in keyof (typeof STR)["en"]]: string };

const z = () => window.zekra!;

function applyChrome(init: CaptureInit) {
  const root = document.documentElement;
  root.classList.toggle("dark", init.dark);
  root.dataset.theme = init.dark ? "dark" : "light";
  root.dataset.platform = init.platform;
  root.dataset.material = init.material;
  root.lang = init.locale;
  root.dir = init.locale === "ar" ? "rtl" : "ltr";
}

function Capture() {
  const [init, setInit] = useState<CaptureInit | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [brain, setBrain] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const t: Strings = STR[init?.locale === "ar" ? "ar" : "en"];

  const receive = useCallback((next: CaptureInit) => {
    applyChrome(next);
    setInit(next);
    setNote(null);
    setBusy(false);
    setBrain((cur) => {
      const ok = (ns: string | null | undefined) => Boolean(ns && next.brains.some((b) => b.namespace === ns));
      if (ok(cur)) return cur;
      if (ok(next.lastBrain)) return next.lastBrain!;
      return next.brains[0]?.namespace ?? "";
    });
    if (next.prefill) {
      if (next.prefill.title) setTitle(next.prefill.title);
      if (next.prefill.body) setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${next.prefill!.body}` : next.prefill!.body!));
      if (next.prefill.tags?.length) setTags(next.prefill.tags.join(", "));
    }
    requestAnimationFrame(() => (titleRef.current?.value ? bodyRef.current : titleRef.current)?.focus());
  }, []);

  // The reading theme repaints this panel too, live (lib/appearance.ts).
  useEffect(() => installAppearanceSync(), []);

  useEffect(() => {
    const off = z().onCaptureShow?.(receive);
    // The first show can race the page load: ask for the state too.
    void z().captureInit?.().then(receive, () => undefined);
    const offTheme = z().onSystemThemeChanged((dark) =>
      setInit((i) => {
        if (!i) return i;
        const next = { ...i, dark };
        applyChrome(next);
        return next;
      }),
    );
    return () => {
      off?.();
      offTheme();
    };
  }, [receive]);

  const close = useCallback(() => void z().captureClose?.(), []);

  const save = useCallback(async () => {
    if (busy || !init) return;
    if (!title.trim() && !body.trim()) {
      setNote({ tone: "warn", text: t.empty });
      return;
    }
    setBusy(true);
    const res = await z().captureSave!({
      namespace: brain,
      title: title.trim(),
      body,
      tags: tags.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
    }).catch((e: unknown) => ({ ok: false, queued: false, error: e instanceof Error ? e.message : String(e) }));
    if (!res.ok) {
      setBusy(false);
      setNote({ tone: "error", text: `${t.failed}${res.error ? ` (${res.error})` : ""}` });
      return;
    }
    setNote({ tone: "ok", text: res.queued ? t.savedOffline : t.saved });
    setTitle("");
    setBody("");
    setTags("");
    setTimeout(close, res.queued ? 1100 : 450);
  }, [busy, init, title, body, tags, brain, t, close]);

  const fromClipboard = useCallback(async () => {
    const c = await z().captureClipboard!();
    if (!c.text) {
      setNote({ tone: "warn", text: t.clipboardEmpty });
      return;
    }
    const piece = c.url ? `<${c.url}>` : c.text;
    setBody((b) => (b.trim() ? `${b.trimEnd()}\n\n${piece}` : piece));
    bodyRef.current?.focus();
  }, [t]);

  const fromBrowser = useCallback(async () => {
    const r = await z().captureBrowserTab!();
    if (r.status === "ok" && r.url) {
      const label = (r.title || r.url).replace(/[[\]]/g, "");
      setTitle((cur) => cur || r.title || "");
      setBody((b) => {
        const link = `[${label}](${r.url})`;
        return b.trim() ? `${b.trimEnd()}\n\n${link}` : link;
      });
      setNote(null);
      bodyRef.current?.focus();
      return;
    }
    const text = r.status === "denied" ? t.denied : r.status === "unsupported" ? t.unsupported : r.status === "no-browser" ? t.noBrowser : `${t.failed}: ${r.message ?? ""}`;
    setNote({ tone: "warn", text });
  }, [t]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  if (!init) return null;
  const mac = init.platform === "darwin";
  const canSave = init.signedIn && init.brains.length > 0 && Boolean(brain);

  return (
    <div
      onKeyDown={onKey}
      className="capture-tint flex h-full flex-col text-foreground"
      style={{ borderRadius: mac ? 12 : undefined }}
    >
      <header className="capture-drag flex h-11 shrink-0 items-center gap-2 px-4">
        <span className="text-[14px] font-semibold">{mac ? "" : "Zekra · "}{t.heading}</span>
        {!init.online ? (
          <span className="rounded-full border border-border px-2 py-px text-[12.5px] text-muted-foreground">{t.offline}</span>
        ) : null}
        <div className="flex-1" />
        {init.brains.length ? (
          <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <span className="sr-only">{t.brain}</span>
            <select
              value={brain}
              onChange={(e) => setBrain(e.target.value)}
              className="h-7 max-w-[220px] rounded-md border-0 bg-[var(--field)] px-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary/40"
            >
              {init.brains.map((b) => (
                <option key={b.namespace} value={b.namespace}>
                  {b.icon ? `${b.icon} ` : ""}
                  {b.displayName || b.namespace}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {!init.signedIn || !init.brains.length ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[14px] text-muted-foreground">
          {!init.signedIn ? t.signedOut : t.noBrains}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1 px-4">
          <input
            ref={titleRef}
            className="capture-field py-1 text-[18px] font-semibold"
            placeholder={t.title}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                bodyRef.current?.focus();
              }
            }}
          />
          <textarea
            ref={bodyRef}
            className="capture-field min-h-0 flex-1 py-1 text-[14.5px] leading-relaxed"
            placeholder={t.body}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <input
            className="capture-field border-t border-border/50 py-2 text-[13px] text-muted-foreground"
            placeholder={t.tags}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      )}

      <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-border/50 px-3">
        <button
          type="button"
          onClick={() => void fromClipboard()}
          disabled={!canSave}
          className="h-7 rounded-md px-2.5 text-[13px] text-foreground/85 hover:bg-foreground/10 disabled:opacity-40"
        >
          {t.clipboard}
        </button>
        {init.browserCapture ? (
          <button
            type="button"
            onClick={() => void fromBrowser()}
            disabled={!canSave}
            className="h-7 rounded-md px-2.5 text-[13px] text-foreground/85 hover:bg-foreground/10 disabled:opacity-40"
          >
            {t.browser}
          </button>
        ) : null}
        <div
          role="status"
          aria-live="polite"
          className={
            "min-w-0 flex-1 truncate px-1 text-[13px] " +
            (note?.tone === "error" ? "text-destructive" : note?.tone === "ok" ? "text-foreground" : "text-muted-foreground")
          }
          title={note?.text}
        >
          {note ? note.text : `${mac ? "⌘↵" : "Ctrl+Enter"} ${t.hint}`}
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || busy}
          className="h-7 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-40"
        >
          {t.save}
        </button>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Capture />);
