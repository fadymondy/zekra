import { useCallback, useEffect, useState } from "react";
import { BrainCircuit, Languages, Moon, Settings as SettingsIcon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

import { ZekraMark } from "./components/zekra-mark";
import { I18nProvider, useI18n } from "./lib/i18n";
import { bridge, type AppSettings, type LocaleId } from "./lib/bridge";
import { authApi, setApiBaseUrl, zekraApi, type AuthAnswer, type Brain, type User } from "./lib/api";
import { SignInScreen } from "./screens/sign-in";
import { Workspace } from "./screens/workspace";

function applyTheme(theme: AppSettings["theme"]) {
  const root = document.documentElement;
  const dark = theme !== "zekra-light";
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
}

function Shell({ settings, setSettings }: {
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const [user, setUser] = useState<User | null>(settings.authUser);
  const [brains, setBrains] = useState<Brain[] | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [version, setVersion] = useState("");
  const [booting, setBooting] = useState(true);

  const token = settings.authToken;
  const activeBrain = brains?.find((b) => b.namespace === settings.activeBrain) ?? null;

  const patch = useCallback(async (p: Partial<AppSettings>) => {
    const next = await bridge().patchSettings(p);
    setSettings(next);
    return next;
  }, [setSettings]);

  // Restore the session and load brains.
  useEffect(() => {
    let alive = true;
    void (async () => {
      bridge().getVersion().then((v) => alive && setVersion(v));
      if (!token) { setBooting(false); return; }
      try {
        const me = await authApi.me(token);
        const resolved = (me as { user?: User }).user ?? (me as User);
        if (alive && resolved?.id) setUser(resolved);
        const { brains: list } = await zekraApi.brains(token);
        if (alive) setBrains(list);
      } catch {
        await bridge().clearSession();
        const fresh = await bridge().getSettings();
        if (alive) { setSettings(fresh); setUser(null); }
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => { alive = false; };
  }, [token, setSettings]);

  // Native menu wiring.
  useEffect(() => {
    const offSettings = bridge().onMenu("settings", () => setShowSettings(true));
    const offSignOut = bridge().onMenu("sign-out", () => void signOut());
    return () => { offSettings(); offSignOut(); };
  });

  async function signIn(answer: AuthAnswer) {
    const next = await patch({ authToken: answer.token, authUser: answer.user });
    setUser(answer.user);
    try {
      const { brains: list } = await zekraApi.brains(next.authToken!);
      setBrains(list);
    } catch { /* the brain list retries on next boot */ }
  }

  async function signOut() {
    if (token) await authApi.logout(token).catch(() => undefined);
    const fresh = await bridge().clearSession();
    setSettings(fresh);
    setUser(null);
    setBrains(null);
  }

  const titleBar = (
    <header className="app-drag flex h-14 shrink-0 items-center gap-3 border-b border-line bg-grid-bg px-4">
      <ZekraMark size={20} />
      <span className="text-sm font-medium">{t("app.name")}</span>
      {activeBrain ? (
        <span className="grid-micro text-grid-muted">{activeBrain.displayName || activeBrain.namespace}</span>
      ) : null}
      <div className="app-no-drag ms-auto flex items-center gap-1">
        {activeBrain ? (
          <Button variant="ghost" size="sm" onClick={() => void patch({ activeBrain: null })}>
            {t("action.switchBrain")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("settings.theme")}
          onClick={() => {
            const next = settings.theme === "zekra-light" ? "zekra-dark" : "zekra-light";
            applyTheme(next);
            void patch({ theme: next });
          }}
        >
          {settings.theme === "zekra-light" ? <Moon /> : <Sun />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("settings.language")}
          onClick={() => {
            const next: LocaleId = locale === "ar" ? "en" : "ar";
            setLocale(next);
            void patch({ locale: next });
          }}
        >
          <Languages />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("settings.title")} onClick={() => setShowSettings(true)}>
          <SettingsIcon />
        </Button>
        {user ? (
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>{t("action.signOut")}</Button>
        ) : null}
      </div>
    </header>
  );

  if (showSettings) {
    return (
      <div className="flex h-full flex-col">
        {titleBar}
        <SettingsPanel
          settings={settings}
          version={version}
          email={user?.email}
          onSave={async (p) => { await patch(p); setApiBaseUrl(p.apiBaseUrl ?? settings.apiBaseUrl); }}
          onClose={() => setShowSettings(false)}
        />
      </div>
    );
  }

  let body: React.ReactNode;
  if (booting) {
    body = <div className="grid-hatch flex flex-1 items-center justify-center text-sm text-grid-muted">{t("brains.loading")}</div>;
  } else if (!token || !user) {
    body = <SignInScreen onSignedIn={signIn} onOpenSettings={() => setShowSettings(true)} />;
  } else if (!activeBrain) {
    body = <BrainPicker brains={brains} onPick={(ns) => void patch({ activeBrain: ns })} />;
  } else {
    body = <Workspace token={token} brain={activeBrain} />;
  }

  return (
    <div className="flex h-full flex-col">
      {titleBar}
      {body}
    </div>
  );
}

/*
The brain picker, matching the web console's grid (MH-267).

Structure copied from web/components/brains/brain-cells.tsx: a hairline grid
(gap-px over bg-line, so the rules between cards are the background showing
through rather than borders that double up), each card carrying a coloured top
rule from the brain's own colour, an avatar, the name, `namespace · role`, the
description, and a three-metric row.

Desktop's brain payload has no recalls or type counts — the web fetches those
per brain in a second request this app does not make. Those two metrics render
"—", which is exactly what the web shows before that fetch resolves, so the
layout is identical rather than approximated.
*/
function BrainPicker({ brains, onPick }: { brains: Brain[] | null; onPick: (ns: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid-hatch flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <h2 className="mb-4 text-xl font-medium">{t("brains.title")}</h2>
        {!brains ? (
          <p className="text-sm text-grid-muted">{t("brains.loading")}</p>
        ) : brains.length === 0 ? (
          <p className="text-sm text-grid-muted">{t("brains.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-px border-y border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
            {brains.map((brain) => (
              <BrainCard key={brain.namespace} brain={brain} onPick={() => onPick(brain.namespace)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BrainCard({ brain, onPick }: { brain: Brain; onPick: () => void }) {
  const { t } = useI18n();
  const name = brain.displayName || brain.namespace;
  const hex = brain.colorHex;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={name}
      className="group relative flex flex-col bg-grid-card text-start transition-colors hover:bg-grid-soft focus-visible:bg-grid-soft focus-visible:outline-none"
    >
      {/* The brain's colour as a top rule; brightens on hover like the web. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 bg-transparent opacity-60 transition-[background-color,opacity] group-hover:opacity-100"
        style={hex ? { backgroundColor: hex } : undefined}
      />

      <div className="flex items-start gap-3 p-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-md"
          style={{ background: hex ? `${hex}22` : "var(--grid-soft)" }}
        >
          <BrainCircuit className="size-5" style={{ color: hex || "var(--grid-action)" }} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium text-grid-fg">{name}</span>
          <div className="mt-1 truncate text-[11px] text-grid-muted">
            {/* plaintext keeps a Latin namespace readable in the Arabic UI. */}
            {name !== brain.namespace ? (
              <>
                <span className="font-mono" style={{ unicodeBidi: "plaintext" }}>
                  {brain.namespace}
                </span>{" "}
                ·{" "}
              </>
            ) : null}
            {brain.role}
          </div>
          {brain.description ? (
            <p className="mt-2 line-clamp-2 text-xs text-grid-muted">{brain.description}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-auto grid grid-cols-3 divide-x divide-line border-t border-line rtl:divide-x-reverse">
        <Metric value={brain.memories.toLocaleString()} label={t("brains.memories")} />
        <Metric value="—" label={t("brains.metric.recalls")} />
        <Metric value="—" label={t("brains.metric.types")} />
      </div>
    </button>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <span className="px-3 py-2">
      <span className="block text-sm text-grid-fg tabular-nums">{value}</span>
      <span className="block text-[10px] tracking-wide text-grid-muted uppercase">{label}</span>
    </span>
  );
}

function SettingsPanel({ settings, version, email, onSave, onClose }: {
  settings: AppSettings;
  version: string;
  email?: string;
  onSave: (patch: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const [apiBaseUrl, setBase] = useState(settings.apiBaseUrl);

  return (
    <ScrollArea className="grid-hatch flex-1">
      <div className="mx-auto max-w-xl p-8">
        <Card>
          <CardHeader><CardTitle>{t("settings.title")}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="api">{t("settings.apiBase")}</Label>
              <Input id="api" value={apiBaseUrl} onChange={(e) => setBase(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("settings.language")}</Label>
              <div className="flex gap-2">
                {(["en", "ar"] as const).map((id) => (
                  <Button
                    key={id}
                    variant={locale === id ? "default" : "outline"}
                    size="sm"
                    onClick={() => { setLocale(id); void onSave({ locale: id }); }}
                  >
                    {id === "en" ? "English" : "العربية"}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />
            {email ? <p className="text-sm text-grid-muted">{t("settings.signedInAs")} {email}</p> : null}
            <p className="grid-micro text-grid-muted">{t("settings.version")} {version}</p>

            <div className="flex gap-2">
              <Button onClick={() => void onSave({ apiBaseUrl: apiBaseUrl.replace(/\/$/, "") }).then(onClose)}>
                {t("action.save")}
              </Button>
              <Button variant="outline" onClick={onClose}>{t("action.close")}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void (async () => {
      const s = await bridge().getSettings();
      setApiBaseUrl(s.apiBaseUrl);
      applyTheme(s.theme);
      setSettings(s);
    })();
  }, []);

  if (!settings) return null; // the native splash covers this

  return (
    <I18nProvider
      initial={settings.locale ?? "en"}
      onChange={(next) => void bridge().patchSettings({ locale: next })}
    >
      <Shell settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}
