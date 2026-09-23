import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import { socialErrorKey, type BrowserProvider, type SocialProvider } from "@mobile/features/social/social-core";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ZekraMark } from "../components/zekra-mark";
import { GitHubMark, GoogleMark } from "../features/social/provider-marks";
import {
  PROVIDER_NAME,
  clearPending,
  exchangeCode,
  loadPending,
  providerOfLink,
  readReturn,
  reopenSocial,
  startSocial,
  useSocialProviders,
  type PendingFlow,
} from "../features/social/social";
import { useI18n } from "../lib/i18n";
import { ApiError, authApi, getApiBaseUrl, type AuthAnswer } from "../lib/api";
import { useOsEvent } from "../shell/os-events";

/*
Sign in: email + password (+ TOTP / recovery 2FA), Forgot password (emailed
reset link, POST /api/auth/password/forgot), and GitHub / Google through the
server's app flow in the system browser (features/social/social.ts): the
browser comes back as zekra://auth/<provider>?code=…, which arrives here as a
"deep-link" OS event and is exchanged for a session. Apple is iOS-only.
*/

type Challenge = { challenge: string } | null;
type Mode = "signin" | "forgot";

export function SignInScreen({ onSignedIn, onOpenSettings }: {
  onSignedIn: (answer: AuthAnswer) => void;
  onOpenSettings: () => void;
}) {
  const { t, locale, isRtl } = useI18n();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<Challenge>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const plan = useSocialProviders();
  // A browser sign-in in flight (restored after a renderer reload).
  const [pending, setPendingState] = useState<PendingFlow | null>(loadPending);
  const pendingRef = useRef(pending);
  const setPending = (p: PendingFlow | null) => {
    pendingRef.current = p;
    setPendingState(p);
    if (!p) clearPending();
  };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** A 2FA-enabled account answers with a challenge instead of a token. */
  function takeChallenge(err: unknown): boolean {
    if (err instanceof ApiError && err.code === "2fa_required") {
      const payload = err.payload as { challenge?: string } | undefined;
      if (payload?.challenge) {
        setChallenge({ challenge: payload.challenge });
        setCode("");
        setRecovery(false);
        return true;
      }
    }
    return false;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const answer = challenge
        ? await authApi.challenge(challenge.challenge, recovery ? { recovery_code: code.trim() } : { code: code.trim() })
        : await authApi.login(email.trim(), password, locale);
      onSignedIn(answer);
    } catch (err) {
      if (takeChallenge(err)) return;
      setError(err instanceof Error ? err.message : t("auth.failed"));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError("");
    try {
      await authApi.forgotPassword(address, locale);
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("account.linkFailed"));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const socialError = (provider: SocialProvider, failure: { status?: number; code?: string; reason?: string; message?: string }) =>
    setError(t(socialErrorKey(provider, failure), { provider: PROVIDER_NAME[provider] }));

  async function startProvider(provider: BrowserProvider) {
    setError("");
    try {
      setPending(await startSocial(provider));
    } catch {
      setPending(null);
      socialError(provider, { reason: "nosheet" });
    }
  }

  // The browser handed the sign-in back: zekra://auth/<provider>?code=…|error=…
  useOsEvent("deep-link", (link) => {
    if (link.host !== "auth") return false;
    const provider = providerOfLink(link.path);
    if (!provider) return false;
    const flow = pendingRef.current ?? loadPending();
    // Not ours (stale tab, another window's flow): swallow it quietly.
    if (!flow || flow.provider !== provider) return;
    setPending(null);
    const back = readReturn(link.url, provider);
    if (back.kind === "cancelled") return;
    if (back.kind === "error") {
      socialError(provider, { reason: back.reason });
      return;
    }
    setBusy(true);
    setError("");
    void exchangeCode(provider, back.code, flow.verifier)
      .then((answer) => onSignedIn(answer))
      .catch((err: unknown) => {
        if (takeChallenge(err)) return;
        const e = err instanceof ApiError ? err : null;
        socialError(provider, { status: e?.status, code: e?.code, message: e?.message });
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
  });

  const Back = isRtl ? ArrowRight : ArrowLeft;
  const providers = (plan?.providers ?? []).filter((p): p is BrowserProvider => p === "google" || p === "github");

  let body;
  if (pending) {
    body = (
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-md border border-line bg-grid-soft text-grid-fg">
          {pending.provider === "github" ? <GitHubMark size={22} /> : <GoogleMark size={22} />}
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-grid-fg">{t("social.waiting", { provider: PROVIDER_NAME[pending.provider] })}</p>
          <p className="text-xs text-grid-muted">{t("social.waitingHint")}</p>
        </div>
        <Loader2 className="size-4 animate-spin text-grid-muted" aria-hidden />
        <div className="flex w-full flex-col gap-2">
          <Button variant="outline" onClick={() => void reopenSocial(pending).catch(() => socialError(pending.provider, { reason: "nosheet" }))}>
            {t("social.reopen")}
          </Button>
          <Button variant="ghost" onClick={() => setPending(null)}>
            {t("action.cancel")}
          </Button>
        </div>
      </div>
    );
  } else if (mode === "forgot") {
    body = (
      <form onSubmit={sendReset} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-grid-fg">{t("auth.resetTitle")}</p>
          <p className="text-sm text-grid-muted">{t("auth.resetIntro")}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-email">{t("auth.email")}</Label>
          <Input
            id="reset-email"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setResetSent(false);
            }}
            autoComplete="username"
            autoFocus
          />
        </div>
        {error ? <p className="text-sm text-grid-danger">{error}</p> : null}
        {resetSent ? (
          <p className="flex items-center gap-2 text-sm text-grid-ok">
            <span aria-hidden className="size-1.5 shrink-0 bg-grid-ok" />
            {t("auth.resetSent")}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? t("auth.sending") : t("auth.sendReset")}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-start px-0"
          onClick={() => {
            setMode("signin");
            setError("");
            setResetSent(false);
          }}
        >
          <Back />
          {t("auth.backToSignIn")}
        </Button>
      </form>
    );
  } else {
    body = (
      <>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {challenge ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{recovery ? t("auth.recoveryCode") : t("auth.authCode")}</Label>
              <Input id="code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus />
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRecovery((v) => !v);
                    setCode("");
                  }}
                >
                  {recovery ? t("auth.useAuthenticator") : t("auth.useRecovery")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setError("");
                  }}
                >
                  {t("auth.startOver")}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <button
                    type="button"
                    className="text-xs text-grid-muted underline-offset-4 hover:text-grid-fg hover:underline"
                    onClick={() => {
                      setMode("forgot");
                      setError("");
                      setResetSent(false);
                    }}
                  >
                    {t("auth.forgot")}
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </>
          )}

          {error ? <p className="text-sm text-grid-danger">{error}</p> : null}

          <Button type="submit" disabled={busy}>
            {busy ? t("action.signingIn") : challenge ? t("action.verify") : t("action.signIn")}
          </Button>
        </form>

        {!challenge && providers.length ? (
          <div className="mt-5 flex flex-col gap-2">
            <div className="flex items-center gap-3 text-xs text-grid-muted">
              <span className="h-px flex-1 bg-line" />
              {t("social.or")}
              <span className="h-px flex-1 bg-line" />
            </div>
            {providers.map((p) => (
              <Button key={p} type="button" variant="outline" disabled={busy} onClick={() => void startProvider(p)}>
                {p === "github" ? <GitHubMark /> : <GoogleMark />}
                {t(p === "github" ? "social.github" : "social.google")}
              </Button>
            ))}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="grid-hatch flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
      <Card className="w-[400px]">
        <CardHeader>
          <ZekraMark size={40} className="mb-3" />
          <CardTitle className="text-2xl">{t("app.name")}</CardTitle>
          <CardDescription>{t("app.tagline")}</CardDescription>
        </CardHeader>
        <CardContent>
          {body}

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="link" size="sm" className="px-0" onClick={onOpenSettings}>
              {t("settings.title")}
            </Button>
            <span className="grid-micro truncate text-grid-muted">
              {t("auth.connecting")}{" "}
              <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                {getApiBaseUrl()}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
