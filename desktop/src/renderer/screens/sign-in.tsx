import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ZekraMark } from "../components/zekra-mark";
import { useI18n } from "../lib/i18n";
import { ApiError, authApi, getApiBaseUrl, type AuthAnswer } from "../lib/api";

type Challenge = { challenge: string } | null;

export function SignInScreen({ onSignedIn, onOpenSettings }: {
  onSignedIn: (answer: AuthAnswer) => void;
  onOpenSettings: () => void;
}) {
  const { t, locale } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<Challenge>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      // A 2FA-enabled account answers the password step with a challenge
      // rather than a token.
      if (err instanceof ApiError && err.code === "2fa_required") {
        const payload = err.payload as { challenge?: string } | undefined;
        if (payload?.challenge) {
          setChallenge({ challenge: payload.challenge });
          setCode("");
          return;
        }
      }
      setError(err instanceof Error ? err.message : t("auth.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid-hatch flex h-full items-center justify-center p-8">
      <Card className="w-[400px]">
        <CardHeader>
          <ZekraMark size={40} className="mb-3" />
          <CardTitle className="text-2xl">{t("app.name")}</CardTitle>
          <CardDescription>{t("app.tagline")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {challenge ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">{recovery ? t("auth.recoveryCode") : t("auth.authCode")}</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => { setRecovery((v) => !v); setCode(""); }}
                >
                  {recovery ? t("auth.useAuthenticator") : t("auth.useRecovery")}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email">{t("auth.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Input
                    id="password"
                    type="password"
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

          <div className="mt-4 flex items-center justify-between">
            <Button variant="link" size="sm" className="px-0" onClick={onOpenSettings}>
              {t("settings.title")}
            </Button>
            <span className="grid-micro text-grid-muted">{t("auth.connecting")} {getApiBaseUrl()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
