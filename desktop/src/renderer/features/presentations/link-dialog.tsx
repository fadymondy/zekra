import { useEffect, useState } from "react";
import { Copy, ExternalLink, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXPIRY_PRESETS, errorMessages } from "@mobile/features/presentations/presentations-core";
import type { PLocale, ShareCreated } from "@mobile/features/presentations/types";

import { ApiError } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../shell/toast";
import { presentationsApi } from "./api";
import { useFormat } from "./format";
import { ErrorLines, Segmented, ToggleChip } from "./parts";

export type LinkDialogState = { mode: "new" } | { mode: "result"; created: ShareCreated };

/*
New share link (POST /api/presentations/{id}/share) and the one moment its
address is guaranteed visible (mobile link-sheet.tsx). When the server
cannot seal tokens (`recoverable: false`) the address is never shown again,
so the result says so plainly and offers Copy / Open right there.
*/
export function LinkDialog({ state, onClose, token, docId, title, locales, defaultLocale, onCreated }: {
  state: LinkDialogState | null;
  onClose: () => void;
  token: string;
  docId: string;
  title: string;
  /** Languages the document has content in (a link needs content). */
  locales: PLocale[];
  defaultLocale: PLocale;
  onCreated: (created: ShareCreated) => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const [label, setLabel] = useState("");
  const [loc, setLoc] = useState<PLocale>(defaultLocale);
  const [days, setDays] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ShareCreated | null>(null);

  useEffect(() => {
    if (!state) return;
    setErrors([]);
    setBusy(false);
    if (state.mode === "result") setResult(state.created);
    else {
      setResult(null);
      setLabel("");
      setDays(0);
      setLoc(locales.includes(defaultLocale) ? defaultLocale : locales[0] ?? "en");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function create() {
    setBusy(true);
    setErrors([]);
    try {
      const out = await presentationsApi.share(token, docId, { label: label.trim() || undefined, locale: loc, expires_in_days: days });
      setResult(out);
      onCreated(out);
    } catch (err) {
      setErrors(err instanceof ApiError ? errorMessages(err.payload, err.message) : [err instanceof Error ? err.message : t("kit.error")]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? t("presentations.share.created") : t("presentations.share.new")}</DialogTitle>
          <DialogDescription className="truncate">{title}</DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <div dir="ltr" className="rounded-md border border-grid-gold bg-grid-gold/10 px-3 py-2.5 text-start font-mono text-xs break-all text-grid-fg select-text">
              {result.url}
            </div>
            {result.recoverable ? (
              <p className="text-xs text-grid-muted">{t("presentations.share.recoverable")}</p>
            ) : (
              <p className="flex items-start gap-2 text-xs font-medium text-grid-warn">
                <KeyRound className="mt-px size-3.5 shrink-0" />
                {t("presentations.share.keep")}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => void bridge().writeClipboardText(result.url).then(() => toast.success(t("kit.copied")))}
              >
                <Copy />
                {t("presentations.share.copy")}
              </Button>
              <Button variant="outline" onClick={() => void bridge().openExternal(result.url)}>
                <ExternalLink />
                {t("presentations.share.openShort")}
              </Button>
              <Button onClick={onClose}>{t("presentations.done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-label">{t("presentations.share.label")}</Label>
              <Input
                id="share-label"
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t("presentations.share.labelPlaceholder")}
                maxLength={80}
              />
            </div>
            {locales.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <span className="grid-micro text-grid-muted">{t("presentations.share.language")}</span>
                <Segmented<PLocale>
                  label={t("presentations.share.language")}
                  value={loc}
                  onChange={setLoc}
                  options={locales.map((l) => ({ value: l, label: f.language(l) }))}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <span className="grid-micro text-grid-muted">{t("presentations.share.expires")}</span>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_PRESETS.map((n) => (
                  <ToggleChip key={n} on={days === n} onClick={() => setDays(n)}>
                    {f.days(n)}
                  </ToggleChip>
                ))}
              </div>
            </div>
            <ErrorLines lines={errors} />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {t("action.cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {t("presentations.share.create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
