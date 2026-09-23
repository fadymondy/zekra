import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  isDeniedStatus,
  isMultilineKind,
  isSecretKind,
  maskValue,
  SECRET_KINDS,
  validateSecretName,
  type SecretKind,
} from "@mobile/features/vault/vault-core";

import { ApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../shell/toast";
import { vaultApi } from "./api";
import { Ltr, tLtr } from "./ltr";

export type FormTarget = { name: string; kind: string } | null;

// Secret names and values are machine strings: always LTR, mono, and never
// touched by spellcheck, autocorrect or autofill.
const MACHINE = {
  dir: "ltr",
  autoCapitalize: "off",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
  "data-1p-ignore": true,
} as const;

/**
 * Add a secret, or replace the value of an existing one (the same name
 * upserts). Updating pre-fills the name (locked) and kind and asks only for a
 * new value — the old value is never loaded into the form. Ported from
 * mobile/src/features/vault/secret-form.tsx.
 */
export function SecretForm({ target, namespace, token, onClose, onSaved }: {
  target: FormTarget;
  namespace: string;
  token: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useI18n();
  const updating = !!target?.name;
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("generic");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open; wipe the value on close so it does not linger.
  useEffect(() => {
    setName(target?.name ?? "");
    setKind(target?.kind && target.kind.trim() ? target.kind : "generic");
    setValue("");
    setVisible(false);
    setTouched(false);
    setAttempted(false);
    setError(null);
  }, [target]);

  const check = validateSecretName(name);
  const nameError = touched && !check.ok ? t(`vault.name.${check.reason}`) : null;
  const multiline = isMultilineKind(kind);
  // An auto-captured kind (aws_key, jwt, …) is kept as-is on update.
  const kinds: string[] = isSecretKind(kind) ? [...SECRET_KINDS] : [...SECRET_KINDS, kind];

  async function save() {
    setTouched(true);
    setAttempted(true);
    if (!check.ok || !value) return;
    setBusy(true);
    setError(null);
    try {
      await vaultApi.put(token, { namespace, name: check.name, value, kind });
      setValue("");
      toast.success(t(updating ? "vault.replaced" : "vault.added"));
      onSaved(check.name);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && isDeniedStatus(caught.status)) setError(t("desk.vault.readOnly"));
      else if (caught instanceof ApiError && caught.status === 0) setError(t("kit.offline"));
      else setError(caught instanceof ApiError && caught.message ? caught.message : t("vault.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(updating ? "vault.form.updateTitle" : "vault.form.addTitle")}</DialogTitle>
          <DialogDescription>
            {tLtr(t, "vault.form.storedIn", "ns", namespace)}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vault-name">{t("vault.form.name")}</Label>
            <Input
              {...MACHINE}
              id="vault-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              readOnly={updating}
              autoFocus={!updating}
              placeholder="OPENAI_API_KEY"
              maxLength={200}
              aria-invalid={!!nameError}
              className={cn("font-mono text-start", updating && "text-muted-foreground")}
            />
            {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
            {nameError && !check.ok && check.suggestion ? (
              <button
                type="button"
                className="self-start text-xs text-grid-action underline-offset-2 hover:underline"
                onClick={() => setName(check.suggestion ?? "")}
              >
                {tLtr(t, "vault.name.use", "name", check.suggestion)}
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("vault.form.kind")}</Label>
            <div role="radiogroup" aria-label={t("vault.form.kind")} className="flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    kind === k
                      ? "border-grid-gold bg-grid-gold/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-hover hover:text-foreground",
                  )}
                >
                  {isSecretKind(k) ? (
                    t(`vault.kind.${k as SecretKind}`)
                  ) : (
                    <Ltr>{k}</Ltr>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vault-value">{t("vault.form.value")}</Label>
            {multiline ? (
              // A textarea cannot be masked; PEM blocks and .env dumps are
              // entered in the clear (as on mobile), but never persisted here.
              <Textarea
                {...MACHINE}
                id="vault-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus={updating}
                placeholder={kind === "env" ? "KEY=value" : "-----BEGIN PRIVATE KEY-----"}
                className="min-h-36 font-mono text-xs text-start"
              />
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  {...MACHINE}
                  id="vault-value"
                  type={visible ? "text" : "password"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoFocus={updating}
                  placeholder="sk-…"
                  className="font-mono text-start"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t(visible ? "vault.form.hideValue" : "vault.form.show")}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            )}
            {updating ? <p className="text-xs text-muted-foreground">{t("vault.form.replaceHint")}</p> : null}
            {value ? (
              <p className="font-mono text-xs text-muted-foreground">
                {tLtr(t, "vault.form.preview", "hint", maskValue(value))}
              </p>
            ) : null}
            {attempted && !value ? <p className="text-xs text-destructive">{t("vault.form.valueRequired")}</p> : null}
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t("vault.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
