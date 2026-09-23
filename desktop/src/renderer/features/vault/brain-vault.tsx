import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileKey,
  KeyRound,
  Loader2,
  Lock,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  SquareTerminal,
  Ticket,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CLIPBOARD_TTL_MS,
  displayHint,
  filterSecrets,
  FILTER_THRESHOLD,
  isDeniedStatus,
  kindIcon,
  kindLabelKey,
  relativeAgo,
  type KindIcon,
} from "@mobile/features/vault/vault-core";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { ApiError, type Brain } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useAuthed } from "../../shell/session";
import { toast } from "../../shell/toast";
import { confirmOwner } from "../security/touch-id";
import { vaultApi, type SecretMeta } from "./api";
import { Ltr, tLtr } from "./ltr";
import { SecretForm, type FormTarget } from "./secret-form";
import { useRevealed, type Revealed } from "./use-revealed";

/*
A brain's secrets vault (MH-450): the "Vault" tab of the brain route. Ported
from mobile/src/features/vault/brain-vault.tsx over its pure vault-core.ts.

Security model, in order:
  - The list is metadata only (masked hints). Values are fetched one at a
    time on Reveal / Copy, which the server allows only with WRITE access, so
    a read-only brain shows no reveal / add / update / delete at all.
  - Every reveal first asks for Touch ID (reason: reveal the secret "<name>");
    on a Mac without Touch ID, a native confirmation instead.
  - A revealed value lives in component state only (never cached, never
    logged), hides after 30 s, and hides when the window loses focus, the app
    goes to the background, or the app lock engages.
  - A copied value is written by main, which wipes the clipboard after 60 s
    if it still holds that value (IPC clipboardWriteSecret).
*/

const KIND_ICONS: Record<KindIcon, LucideIcon> = {
  shield: Shield,
  "key-round": KeyRound,
  lock: Lock,
  ticket: Ticket,
  terminal: SquareTerminal,
  "file-key": FileKey,
  database: Database,
  "badge-check": BadgeCheck,
};

export function BrainVault({ brain }: { brain: Brain }) {
  const { t } = useI18n();
  const { token } = useAuthed();
  const ns = brain.namespace;
  const canWrite = brain.canWrite;

  const [list, setList] = useState<SecretMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const revealed = useRevealed();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormTarget>(null);
  const [deleting, setDeleting] = useState<SecretMeta | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const out = await vaultApi.list(token, ns);
      setList(out.secrets ?? []);
    } catch (e) {
      setLoadError(e instanceof ApiError && e.status === 0 ? t("kit.offline") : e instanceof Error ? e.message : t("kit.error"));
    } finally {
      setLoading(false);
    }
  }, [token, ns, t]);

  // A new brain gets a clean slate.
  const { hideAll } = revealed;
  useEffect(() => {
    hideAll();
    setRowError({});
    setFilter("");
    setList(null);
    void load();
  }, [ns, hideAll, load]);

  const all = useMemo(() => list ?? [], [list]);
  const visible = useMemo(() => filterSecrets(all, filter), [all, filter]);

  function setError(name: string, message: string | null) {
    setRowError((prev) => {
      const next = { ...prev };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }

  /** Owner check, then POST reveal. The value, or null when cancelled / refused / overtaken. */
  async function fetchValue(s: SecretMeta, purpose: "reveal" | "copy"): Promise<{ value: string; epoch: number } | null> {
    if (!canWrite) {
      setError(s.name, t("vault.denied"));
      return null;
    }
    const epoch = revealed.begin();
    setBusy(s.name);
    setError(s.name, null);
    try {
      const gate = await confirmOwner(
        purpose === "reveal" ? `reveal the secret "${s.name}"` : `copy the secret "${s.name}"`,
        {
          message: t("desk.vault.confirmTitle", { name: s.name }),
          detail: t(purpose === "reveal" ? "desk.vault.confirmBody" : "desk.vault.confirmCopyBody"),
          confirm: t(purpose === "reveal" ? "vault.reveal" : "vault.copy"),
          cancel: t("action.cancel"),
        },
      );
      if (gate === "cancel") return null;
      if (gate === "failed") {
        setError(s.name, t("vault.authFailed"));
        return null;
      }
      const answer = await vaultApi.reveal(token, s.namespace, s.name);
      return { value: answer.value, epoch };
    } catch (caught) {
      // Never surface or log the payload — only the status decides the message.
      const status = caught instanceof ApiError ? caught.status : undefined;
      setError(s.name, isDeniedStatus(status) ? t("vault.denied") : status === 0 ? t("kit.offline") : t("vault.revealFailed"));
      if (status === 404) void load(); // deleted elsewhere
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function reveal(s: SecretMeta) {
    const got = await fetchValue(s, "reveal");
    if (got) revealed.show(s.name, got.value, got.epoch);
  }

  async function copy(value: string) {
    try {
      await bridge().writeSecretText(value, CLIPBOARD_TTL_MS);
      toast.success(t("desk.vault.copiedWipe"));
    } catch {
      toast.error(t("kit.error"));
    }
  }

  /** Copy from the menu: reuse a value on screen, else confirm + fetch and copy without displaying it. */
  async function copyValue(s: SecretMeta) {
    const shown = revealed.values[s.name];
    if (shown) return copy(shown.value);
    const got = await fetchValue(s, "copy");
    if (got && got.epoch === revealed.begin()) await copy(got.value);
  }

  async function remove(s: SecretMeta) {
    setDeleting(null);
    revealed.hide(s.name);
    try {
      await vaultApi.remove(token, s.namespace, s.name);
      toast.success(t("vault.deleted"));
      void load();
    } catch (caught) {
      const status = caught instanceof ApiError ? caught.status : undefined;
      toast.error(isDeniedStatus(status) ? t("desk.vault.readOnly") : t("vault.deleteFailed"));
    }
  }

  function toggle(s: SecretMeta) {
    if (busy) return;
    if (revealed.values[s.name]) revealed.hide(s.name);
    else void reveal(s);
  }

  return (
    <div className="grid-hatch flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
        {/* Intro + primary action / read-only explanation */}
        <div className="flex items-start gap-4 rounded-md border border-line bg-grid-card p-4">
          <p className="flex-1 text-xs leading-5 text-grid-muted">{t("vault.intro")}</p>
          <Button variant="ghost" size="icon-sm" aria-label={t("action.refresh")} disabled={loading} onClick={() => void load()}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
          {canWrite ? (
            <Button size="sm" onClick={() => setForm({ name: "", kind: "generic" })}>
              <Plus />
              {t("vault.new")}
            </Button>
          ) : null}
        </div>
        {!canWrite ? (
          <div className="flex items-start gap-2.5 rounded-md border border-line bg-grid-card px-4 py-3">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-grid-gold" strokeWidth={1.6} />
            <p className="text-xs leading-5 text-grid-body">{t("vault.readOnlyNote")}</p>
          </div>
        ) : null}

        {all.length > FILTER_THRESHOLD ? (
          <div className="flex items-center gap-3">
            <Input
              aria-label={t("vault.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("vault.filterPlaceholder")}
              className="max-w-xs"
              spellCheck={false}
            />
            <span className="grid-micro text-grid-muted">
              {filter.trim() ? t("vault.countFiltered", { n: visible.length, total: all.length }) : t("vault.count", { n: all.length })}
            </span>
          </div>
        ) : null}

        {list === null && !loadError ? (
          <p className="flex items-center gap-2 text-sm text-grid-muted">
            <Loader2 className="size-4 animate-spin" />
            {t("action.refresh")}
          </p>
        ) : null}
        {loadError ? (
          <div className="flex items-center gap-3 text-sm text-grid-danger">
            <span>{loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t("kit.retry")}
            </Button>
          </div>
        ) : null}
        {list !== null && all.length === 0 ? (
          <div className="rounded-md border border-dashed border-line px-4 py-8 text-center">
            <p className="text-sm text-grid-fg">{t("vault.emptyList")}</p>
            {canWrite ? <p className="mt-1 text-xs text-grid-muted">{t("vault.emptyHint")}</p> : null}
          </div>
        ) : null}
        {all.length > 0 && visible.length === 0 ? <p className="text-sm text-grid-muted">{t("vault.noMatch")}</p> : null}

        {visible.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-grid-card">
            {visible.map((s) => (
              <SecretRow
                key={s.name}
                s={s}
                canWrite={canWrite}
                shown={revealed.values[s.name]}
                busy={busy === s.name}
                error={rowError[s.name]}
                onToggle={() => toggle(s)}
                onCopy={() => void copyValue(s)}
                onHide={() => revealed.hide(s.name)}
                onUpdate={() => setForm({ name: s.name, kind: s.kind || "generic" })}
                onDelete={() => setDeleting(s)}
              />
            ))}
          </ul>
        ) : null}
      </div>

      {canWrite ? (
        <SecretForm
          target={form}
          namespace={ns}
          token={token}
          onClose={() => setForm(null)}
          onSaved={(name) => {
            revealed.hide(name); // a shown value is stale now
            setError(name, null);
            void load();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        title={t("vault.deleteTitle", { name: deleting?.name ?? "" })}
        body={t("vault.deleteBody")}
        confirmLabel={t("vault.delete")}
        destructive
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function SecretRow({ s, canWrite, shown, busy, error, onToggle, onCopy, onHide, onUpdate, onDelete }: {
  s: SecretMeta;
  canWrite: boolean;
  shown?: Revealed;
  busy: boolean;
  error?: string;
  onToggle: () => void;
  onCopy: () => void;
  onHide: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const labelKey = kindLabelKey(s.kind);
  const ago = relativeAgo(s.updatedAt);
  const when = ago ? t(`vault.time.${ago.unit}`, { n: ago.n }) : null;
  const Icon = KIND_ICONS[kindIcon(s.kind)];

  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", shown && "bg-grid-gold/5")}>
      <span
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border",
          shown ? "border-grid-gold text-grid-gold" : "border-line text-grid-muted",
        )}
      >
        <Icon className="size-4" strokeWidth={1.6} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <bdi dir="ltr" className="truncate font-mono text-[13px] font-medium text-grid-fg">
            {s.name}
          </bdi>
          <span
            className={cn(
              "rounded-sm border px-1.5 py-px text-[10px] tracking-wide uppercase",
              shown ? "border-grid-gold/60 text-grid-gold" : "border-line text-grid-muted",
            )}
          >
            {labelKey ? t(labelKey) : <Ltr>{s.kind}</Ltr>}
          </span>
        </div>

        {shown ? (
          <div className="flex flex-col gap-2 pt-1">
            {/* The value itself: selectable, LTR, never isolate-marked (the marks would be copied along). */}
            <pre
              dir="ltr"
              className="max-h-48 overflow-auto rounded-md border border-grid-gold/40 bg-grid-gold/5 px-3 py-2 text-start font-mono text-xs leading-5 whitespace-pre-wrap break-all text-grid-fg select-text"
            >
              {shown.value}
            </pre>
            <div className="flex items-center gap-2">
              <Countdown until={shown.until} />
              <span className="flex-1" />
              <Button variant="outline" size="xs" onClick={onCopy}>
                <Copy />
                {t("vault.copy")}
              </Button>
              <Button variant="ghost" size="xs" onClick={onHide}>
                <EyeOff />
                {t("vault.hide")}
              </Button>
            </div>
          </div>
        ) : (
          <bdi dir="ltr" className="font-mono text-xs tracking-wide text-grid-muted">
            {displayHint(s.hint)}
          </bdi>
        )}

        <p className="text-[11px] text-grid-muted">
          {[
            s.createdBy ? tLtr(t, "vault.by", "who", s.createdBy) : null,
            when ? t("vault.updated", { when }) : null,
          ]
            .filter(Boolean)
            .map((part, i) => (
              <span key={i}>
                {i > 0 ? " · " : null}
                {part}
              </span>
            ))}
        </p>
        {s.sourceRef ? (
          <p className="truncate text-[11px] text-grid-muted">{tLtr(t, "vault.source", "ref", s.sourceRef)}</p>
        ) : null}
        {error ? <p className="text-xs text-grid-danger">{error}</p> : null}
      </div>

      {canWrite ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t(shown ? "vault.hide" : "vault.reveal")}
            title={t(shown ? "vault.hide" : "vault.reveal")}
            disabled={busy}
            onClick={onToggle}
            className={cn(shown && "text-grid-gold")}
          >
            {busy ? <Loader2 className="animate-spin" /> : shown ? <EyeOff /> : <Eye />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={t("desk.vault.more", { name: s.name })} disabled={busy} />}
            >
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={onToggle}>
                {shown ? <EyeOff /> : <Eye />}
                {t(shown ? "vault.hide" : "vault.reveal")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCopy}>
                <Copy />
                <span className="flex flex-col">
                  <span>{t("vault.copyValue")}</span>
                  <span className="text-[11px] text-grid-muted">{t("vault.copyValueDetail")}</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onUpdate}>
                <Pencil />
                {t("vault.update")}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 />
                {t("vault.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </li>
  );
}

/** "Hides in 24s", ticking once a second while a value is on screen. */
function Countdown({ until }: { until: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return <span className="grid-micro text-grid-muted">{t("vault.hidesIn", { s })}</span>;
}
