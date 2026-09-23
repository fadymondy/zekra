import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LogOut, Mail, Trash2, TriangleAlert, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { authApi } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { AccountAvatar } from "../../shell/account-menu";
import { useAuthed } from "../../shell/session";
import { toast } from "../../shell/toast";
import { accountApi, type AccountProfile, type DeleteState } from "./api";
import { Group, Row, SettingsHeader } from "./ui";

/*
Settings ▸ Account — mobile's Account area (app/(tabs)/(account)/account/*):

  Profile   display name + timezone (GET/PUT /api/me/account/profile); the
            email is the sign-in identity, read-only
  Password  the API has no authenticated change-password route: the emailed
            reset link (POST /api/auth/password/forgot) is the supported path
  Delete    password-confirmed, SCHEDULED deletion (POST /api/me/delete),
            cancellable until it runs (POST /api/me/delete/cancel)
*/

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function AccountSettings() {
  const { t } = useI18n();
  const { user, signOut } = useAuthed();
  return (
    <>
      <div className="flex items-center gap-4">
        <AccountAvatar size={48} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium text-grid-fg">{user.name || t("settingsx.account")}</h1>
          <p dir="ltr" className="truncate font-grid-mono text-xs text-grid-muted" style={{ unicodeBidi: "isolate" }}>
            {user.email}
          </p>
        </div>
        <Button variant="outline" size="sm" className="ms-auto" onClick={() => void signOut()}>
          <LogOut />
          {t("action.signOut")}
        </Button>
      </div>
      <ProfileGroup />
      <PasswordGroup />
      <DeleteGroup />
    </>
  );
}

function ProfileGroup() {
  const { t } = useI18n();
  const { token, user } = useAuthed();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const p = await accountApi.profile(token);
      setProfile(p);
      setName(p.name ?? "");
      setTimezone(p.timezone ?? "");
    } catch {
      setLoadError(true);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);

  const dirty = profile !== null && (name.trim() !== (profile.name ?? "") || timezone.trim() !== (profile.timezone ?? ""));

  async function save() {
    setSaving(true);
    setError("");
    try {
      const next = await accountApi.updateProfile(token, { name: name.trim(), timezone: timezone.trim() });
      setProfile({ ...profile, ...next, name: next.name ?? name.trim(), timezone: next.timezone ?? timezone.trim() });
      toast.success(t("account.saved"));
    } catch (e) {
      setError(errorText(e, t("account.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Group title={t("account.profile")}>
      {loadError ? (
        <Row label={<span className="text-grid-danger">{t("account.loadFailed")}</span>}>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("action.retry")}
          </Button>
        </Row>
      ) : !profile ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <>
          <Row label={t("account.email")}>
            <span dir="ltr" className="font-grid-mono text-xs text-grid-muted" style={{ unicodeBidi: "isolate" }}>
              {profile.email ?? user.email}
            </span>
          </Row>
          <Row label={t("account.name")} htmlFor="profile-name" stack>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Row>
          <Row label={t("account.timezone")} htmlFor="profile-tz" stack>
            <Input
              id="profile-tz"
              dir="ltr"
              className="font-grid-mono"
              list="profile-tz-list"
              value={timezone}
              placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh"}
              onChange={(e) => setTimezone(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id="profile-tz-list">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </Row>
          <div className="flex items-center gap-3 px-4 py-3">
            {error ? <p className="flex-1 text-sm text-grid-danger">{error}</p> : <span className="flex-1" />}
            <Button onClick={() => void save()} disabled={!dirty || saving}>
              <Check />
              {t("account.saveProfile")}
            </Button>
          </div>
        </>
      )}
    </Group>
  );
}

function PasswordGroup() {
  const { t, locale } = useI18n();
  const { user } = useAuthed();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setBusy(true);
    setError("");
    try {
      await authApi.forgotPassword(user.email, locale);
      setSent(true);
    } catch (e) {
      setError(errorText(e, t("account.linkFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group title={t("account.password")} description={t("account.passwordBody")}>
      <Row
        label={t("account.sentTo")}
        hint={
          <span dir="ltr" className="font-grid-mono" style={{ unicodeBidi: "isolate" }}>
            {user.email}
          </span>
        }
      >
        <Button variant="outline" onClick={() => void send()} disabled={busy}>
          <Mail />
          {t("account.sendPasswordLink")}
        </Button>
      </Row>
      {sent || error ? (
        <div className="px-4 py-3 text-sm">
          {error ? (
            <p className="text-grid-danger">{error}</p>
          ) : (
            <p className="flex items-center gap-2 text-grid-ok">
              <span aria-hidden className="size-1.5 bg-grid-ok" />
              {t("account.passwordSent")}
            </p>
          )}
        </div>
      ) : null}
    </Group>
  );
}

function DeleteGroup() {
  const { t, locale } = useI18n();
  const { token } = useAuthed();
  const [state, setState] = useState<DeleteState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      setState(await accountApi.deleteState(token));
    } catch {
      setLoadError(true);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    setConfirming(false);
    setBusy(true);
    setError("");
    try {
      setState(await accountApi.deleteAccount(token, password));
      setPassword("");
    } catch (e) {
      setError(errorText(e, t("account.deleteFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      setState(await accountApi.cancelDelete(token));
    } catch (e) {
      setError(errorText(e, t("account.cancelFailed")));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso?: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { dateStyle: "long" }).format(d);
  };

  return (
    <Group title={t("settingsx.danger")} tone="danger">
      {loadError ? (
        <Row label={<span className="text-grid-danger">{t("account.loadFailed")}</span>}>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("action.retry")}
          </Button>
        </Row>
      ) : !state ? (
        <div className="p-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : state.status === "scheduled" ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="flex items-center gap-2 text-sm font-medium text-grid-fg">
            <TriangleAlert className="size-4 text-grid-warn" />
            {t("account.deleteScheduled")}
          </p>
          <p className="text-sm text-grid-muted">{t("account.deleteScheduledBody")}</p>
          <p className="text-xs text-grid-muted">
            {t("account.deleteScheduledFor")} <span className="font-grid-mono text-grid-gold">{when(state.scheduled_for)}</span>
          </p>
          {error ? <p className="text-sm text-grid-danger">{error}</p> : null}
          <div>
            <Button variant="outline" onClick={() => void cancel()} disabled={busy}>
              <Undo2 />
              {t("account.cancelDelete")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-sm font-medium text-grid-fg">{t("account.delete")}</p>
          <p className="text-sm text-grid-muted">{t("account.deleteWarn")}</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) setConfirming(true);
            }}
          >
            <Input
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("account.currentPassword")}
              aria-label={t("account.currentPassword")}
              autoComplete="current-password"
            />
            <Button type="submit" variant="destructive" disabled={!password || busy}>
              <Trash2 />
              {t("account.deleteConfirm")}
            </Button>
          </form>
          {error ? <p className="text-sm text-grid-danger">{error}</p> : null}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={t("account.deleteConfirmTitle")}
        body={t("account.deleteWarn")}
        confirmLabel={t("account.deleteConfirm")}
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </Group>
  );
}
