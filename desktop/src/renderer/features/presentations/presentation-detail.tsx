import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Eye,
  KeyRound,
  Languages,
  Link2,
  Loader2,
  Maximize2,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  STATUSES,
  customerLine,
  downloadVia,
  editUrl,
  errorMessages,
  exportFileName,
  knownUrl,
  missingLocale,
  orderedLocales,
  shareState,
  sortShares,
  webOriginFrom,
  PREVIEW_LABEL,
} from "@mobile/features/presentations/presentations-core";
import type { Detail, PLocale, PStatus, Share, ShareCreated } from "@mobile/features/presentations/types";

import { ConfirmDialog } from "../../components/confirm-dialog";
import { ApiError, getApiBaseUrl } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../shell/toast";
import { presentationsApi } from "./api";
import { useFormat } from "./format";
import { LinkDialog, type LinkDialogState } from "./link-dialog";
import { Chip, ErrorLines, KindTile, LocaleChips, Micro, Segmented, StatusChip } from "./parts";
import { PresentationPreview } from "./preview";

/*
One presentation (MH-450), ported from mobile's presentation-detail.tsx:
summary, a native preview (web viewers, EN/AR switch, full screen), share
links (create / copy / open / reissue / revoke / revoke all), downloads
(PDF / DOCX through a share link, saved with the native save panel), status,
translate, delete, and "Edit on the web" for slide content.
*/

// Share addresses this app session has seen for links whose token the server
// cannot show again (not recoverable). Keyed by share id; kept across mounts.
const SESSION_URLS: Record<string, string> = {};

function message(err: unknown, fallback: string) {
  if (err instanceof ApiError) return errorMessages(err.payload, err.message || fallback).join("\n");
  return err instanceof Error ? err.message : fallback;
}

type Confirm = { title: string; body: string; label: string; run: () => void };

export function PresentationDetail({ id, token, canWrite, onClose, onChanged, onDeleted }: {
  id: string;
  token: string;
  canWrite: boolean;
  onClose: () => void;
  /** The list should refresh (status, links, title changed). */
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const { t, locale } = useI18n();
  const f = useFormat();
  const [doc, setDoc] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<Record<string, string>>(() => ({ ...SESSION_URLS }));
  const [link, setLink] = useState<LinkDialogState | null>(null);
  const [previewLocale, setPreviewLocale] = useState<PLocale | null>(null);
  const [full, setFull] = useState(false);
  const [dlLocale, setDlLocale] = useState<PLocale | null>(null);
  const [exported, setExported] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setDoc(await presentationsApi.get(token, id));
    } catch (e) {
      setDoc(null);
      setLoadError(e instanceof ApiError && e.status === 404 ? t("presentations.detail.missing") : message(e, t("kit.error")));
    } finally {
      setLoading(false);
    }
  }, [token, id, t]);

  useEffect(() => {
    setDoc(null);
    setPreviewLocale(null);
    setDlLocale(null);
    setExported({});
    setTranslateError("");
    void load();
  }, [load]);

  const remember = (created: ShareCreated) => {
    SESSION_URLS[created.share.id] = created.url;
    setUrls((m) => ({ ...m, [created.share.id]: created.url }));
  };
  const changed = (next?: Detail) => {
    if (next) setDoc(next);
    else void load();
    onChanged();
  };

  async function run<T>(key: string, fn: () => Promise<T>, ok?: (out: T) => void) {
    setBusy(key);
    try {
      const out = await fn();
      ok?.(out);
    } catch (err) {
      toast.error(message(err, t("kit.error")));
    } finally {
      setBusy(null);
    }
  }

  if (!doc) {
    return (
      <Pane onClose={onClose}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          {loading ? (
            <Loader2 className="size-5 animate-spin text-grid-muted" />
          ) : (
            <>
              <p className="max-w-sm text-sm text-grid-muted">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("kit.retry")}
              </Button>
            </>
          )}
        </div>
      </Pane>
    );
  }

  const locales = orderedLocales(doc.locales);
  const primary: PLocale = locales.includes(doc.locale as PLocale) ? (doc.locale as PLocale) : locales[0] ?? "en";
  const shownLocale = previewLocale && locales.includes(previewLocale) ? previewLocale : primary;
  const shares = sortShares(doc.shares ?? []);
  const activeCount = shares.filter((s) => shareState(s) === "active").length;
  const archived = doc.status === "archived";
  const formats = doc.formats ?? [];
  const missing = missingLocale(doc.locales);
  const fileLocale = dlLocale && locales.includes(dlLocale) ? dlLocale : primary;
  const viewed = f.ago(doc.last_viewed_at);
  const webOrigin = webOriginFrom(getApiBaseUrl());

  // ── Downloads ──
  async function fileUrl(format: string): Promise<string> {
    const via = downloadVia(shares, urls, fileLocale, format);
    if (via) return via;
    if (exported[fileLocale]?.[format]) return exported[fileLocale][format];
    if (!canWrite || !doc) return "";
    // The server picks a copyable link for the language or makes a 7-day "export" link.
    const out = await presentationsApi.export(token, doc.id, fileLocale);
    setExported((m) => ({ ...m, [fileLocale]: out.customer_downloads }));
    if (out.created_link) changed();
    return out.customer_downloads[format] ?? "";
  }

  async function onFile(format: string, how: "open" | "save") {
    if (!doc) return;
    setBusy(`file:${format}:${how}`);
    try {
      const url = await fileUrl(format);
      if (!url) {
        toast.error(t("presentations.dl.none"));
        return;
      }
      if (how === "open") {
        await bridge().openExternal(url);
        return;
      }
      // Fetched by main (same-origin with the API only); a link on another
      // domain (custom share domain, api./app. split) opens in the browser.
      const res = await bridge().apiBinary(url);
      if (res.ok && res.bytes) {
        const name = exportFileName(doc.title || "presentation", fileLocale, format);
        const saved = await bridge().saveFile({
          suggestedName: name,
          bytes: res.bytes,
          filters: [format === "pdf" ? { name: "PDF", extensions: ["pdf"] } : { name: "Word", extensions: ["docx"] }],
        });
        if (!saved.canceled) toast.success(t("desk.pres.savedTo", { name: saved.path?.split("/").pop() ?? name }));
      } else if (res.status === 0) {
        await bridge().openExternal(url);
        toast(t("desk.pres.openedInBrowser"));
      } else {
        toast.error(t("presentations.dl.failed"));
      }
    } catch (err) {
      toast.error(message(err, t("presentations.dl.failed")));
    } finally {
      setBusy(null);
    }
  }

  const ask = (title: string, body: string, label: string, fn: () => void) => setConfirm({ title, body, label, run: fn });

  return (
    <Pane
      onClose={onClose}
      header={
        <>
          <KindTile kind={doc.kind} size={32} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium text-grid-fg" style={{ unicodeBidi: "plaintext" }}>
              {doc.title || t("notes.untitled")}
            </h2>
            <p className="grid-micro truncate text-grid-muted">
              {f.kind(doc.kind)} · {f.status(doc.status)}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label={t("action.refresh")} onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void bridge().openExternal(editUrl(webOrigin, locale, doc.namespace, doc.id))}
          >
            <ExternalLink />
            {t("presentations.edit.web")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        {/* Summary */}
        <Card>
          <Micro>{t("presentations.section.summary")}</Micro>
          <div className="grid grid-cols-2 gap-4">
            <KV label={t("presentations.sum.customer")}>
              <p className="text-sm text-grid-fg">{customerLine(doc.customer) || "—"}</p>
              {doc.customer?.email ? (
                <p dir="ltr" className="text-start text-xs text-grid-muted" style={{ unicodeBidi: "isolate" }}>
                  {doc.customer.email}
                </p>
              ) : null}
            </KV>
            <KV label={t("presentations.sum.languages")}>
              <div className="flex flex-wrap gap-1.5">
                <LocaleChips locales={doc.locales} />
                <StatusChip status={doc.status} />
                {doc.kind === "page" && doc.style ? <Chip>{f.style(doc.style)}</Chip> : null}
              </div>
            </KV>
          </div>
          <Meta
            items={[
              t("presentations.sum.views", { n: doc.view_count }),
              t("presentations.sum.downloads", { n: doc.download_count }),
              t("presentations.sum.links", { n: activeCount }),
              viewed ? t("presentations.sum.lastViewed", { when: viewed }) : t("presentations.neverViewed"),
              t("presentations.sum.updated", { when: f.ago(doc.updated_at) }),
            ]}
          />
        </Card>

        {/* Preview */}
        <Card>
          <Micro
            end={
              locales.length ? (
                <>
                  {locales.length > 1 ? (
                    <Segmented<PLocale>
                      label={t("desk.pres.previewLanguage")}
                      value={shownLocale}
                      onChange={setPreviewLocale}
                      options={locales.map((l) => ({ value: l, label: f.short(l) }))}
                    />
                  ) : null}
                  <Button variant="ghost" size="icon-sm" aria-label={t("desk.pres.fullScreen")} title={t("desk.pres.fullScreen")} onClick={() => setFull(true)}>
                    <Maximize2 />
                  </Button>
                </>
              ) : null
            }
          >
            {t("presentations.section.preview")}
          </Micro>
          <div className="max-h-[70vh] overflow-auto rounded-md border border-line">
            <PresentationPreview key={`${doc.id}:${shownLocale}:${doc.updated_at}`} token={token} doc={doc} locale={shownLocale} />
          </div>
          <p className="text-xs text-grid-muted">{t("desk.pres.previewHelp")}</p>
        </Card>

        {/* Share links */}
        <Card>
          <Micro
            end={
              canWrite && !archived && locales.length ? (
                <Button variant="ghost" size="xs" onClick={() => setLink({ mode: "new" })}>
                  <Plus />
                  {t("presentations.share.new")}
                </Button>
              ) : null
            }
          >
            {t("presentations.section.links")}
          </Micro>
          {archived ? <p className="text-xs text-grid-muted">{t("presentations.archivedNote")}</p> : null}
          {shares.length === 0 ? <p className="text-xs text-grid-muted">{t("presentations.share.none")}</p> : null}
          {shares.length ? (
            <ul className="divide-y divide-line">
              {shares.map((s) => (
                <ShareItem
                  key={s.id}
                  share={s}
                  url={knownUrl(s, urls)}
                  canWrite={canWrite}
                  busy={busy === `share:${s.id}`}
                  onReissue={() =>
                    ask(t("presentations.share.reissueConfirm"), t("presentations.share.reissueBody"), t("presentations.share.reissue"), () =>
                      void run(`share:${s.id}`, () => presentationsApi.reissue(token, doc.id, s.id), (out) => {
                        remember(out);
                        changed();
                        setLink({ mode: "result", created: out });
                      }),
                    )
                  }
                  onRevoke={() =>
                    ask(t("presentations.share.revokeConfirm"), t("presentations.share.revokeBody"), t("presentations.share.revoke"), () =>
                      void run(`share:${s.id}`, () => presentationsApi.revoke(token, doc.id, s.id), () => {
                        changed();
                        toast.success(t("presentations.share.revokedToast"));
                      }),
                    )
                  }
                />
              ))}
            </ul>
          ) : null}
        </Card>

        {/* Downloads */}
        {formats.length ? (
          <Card>
            <Micro
              end={
                locales.length > 1 && !archived ? (
                  <Segmented<PLocale>
                    label={t("presentations.share.language")}
                    value={fileLocale}
                    onChange={setDlLocale}
                    options={locales.map((l) => ({ value: l, label: f.language(l) }))}
                  />
                ) : null
              }
            >
              {t("presentations.section.downloads")}
            </Micro>
            {archived ? (
              <p className="text-xs text-grid-muted">{t("presentations.archivedNote")}</p>
            ) : (
              <>
                <ul className="divide-y divide-line">
                  {formats.map((fmt) => (
                    <li key={fmt} className="flex items-center gap-3 py-2">
                      <span className="flex size-8 items-center justify-center rounded-md border border-line text-grid-body">
                        <Download className="size-4" strokeWidth={1.6} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-grid-fg">{fmt === "docx" ? t("presentations.dl.docx") : t("presentations.dl.pdf")}</p>
                        <p className="text-xs text-grid-muted">{f.language(fileLocale)}</p>
                      </div>
                      <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void onFile(fmt, "open")}>
                        {busy === `file:${fmt}:open` ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                        {t("presentations.dl.open")}
                      </Button>
                      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void onFile(fmt, "save")}>
                        {busy === `file:${fmt}:save` ? <Loader2 className="animate-spin" /> : <Download />}
                        {t("desk.pres.save")}
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-grid-muted">{t("presentations.dl.help")}</p>
              </>
            )}
          </Card>
        ) : null}

        {/* Status + languages */}
        {canWrite ? (
          <Card>
            <Micro>{t("presentations.section.status")}</Micro>
            <Segmented<PStatus>
              label={t("presentations.section.status")}
              value={(STATUSES as string[]).includes(doc.status) ? (doc.status as PStatus) : "draft"}
              disabled={busy === "status"}
              onChange={(s) => {
                if (s === doc.status || busy === "status") return;
                void run("status", () => presentationsApi.update(token, id, { status: s }), (next) => {
                  changed(next);
                  toast.success(t("presentations.saved"));
                });
              }}
              options={STATUSES.map((s) => ({ value: s, label: f.status(s) }))}
            />
            <p className="text-xs text-grid-muted">{t("presentations.status.help")}</p>
            {missing ? (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === "translate"}
                    onClick={async () => {
                      setTranslateError("");
                      setBusy("translate");
                      try {
                        const next = await presentationsApi.translate(token, id, missing);
                        changed(next);
                        toast.success(t("presentations.translate.done"));
                      } catch (err) {
                        const noModel = err instanceof ApiError && (err.code === "no_translator" || err.status === 503);
                        setTranslateError(noModel ? t("presentations.translate.noTranslator") : message(err, t("kit.error")));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === "translate" ? <Loader2 className="animate-spin" /> : <Languages />}
                    {t("presentations.translate.action", { lang: f.language(missing) })}
                  </Button>
                </div>
                <p className="text-xs text-grid-muted">{t("presentations.translate.help")}</p>
                {translateError ? <ErrorLines lines={[translateError]} /> : null}
              </div>
            ) : null}
          </Card>
        ) : (
          <Card>
            <p className="text-xs text-grid-muted">{t("desk.pres.readOnly")}</p>
          </Card>
        )}

        {/* Manage */}
        <Card>
          <Micro>{t("presentations.section.manage")}</Micro>
          <p className="text-xs text-grid-muted">{t("presentations.edit.help")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void bridge().openExternal(editUrl(webOrigin, locale, doc.namespace, doc.id))}>
              <ExternalLink />
              {t("presentations.edit.web")}
            </Button>
            {canWrite && activeCount > 1 ? (
              <Button
                variant="outline"
                size="sm"
                className="text-grid-danger"
                disabled={busy === "revokeAll"}
                onClick={() =>
                  ask(t("presentations.share.revokeAllConfirm"), t("presentations.share.revokeBody"), t("presentations.share.revokeAll"), () =>
                    void run("revokeAll", () => presentationsApi.revokeAll(token, id), () => {
                      changed();
                      toast.success(t("presentations.share.revokedToast"));
                    }),
                  )
                }
              >
                {t("presentations.share.revokeAll")}
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="outline"
                size="sm"
                className="text-grid-danger"
                disabled={busy === "delete"}
                onClick={() =>
                  ask(t("presentations.deleteConfirm"), t("presentations.deleteBody"), t("action.delete"), () =>
                    void run("delete", () => presentationsApi.remove(token, id), () => {
                      toast.success(t("presentations.deleted"));
                      onDeleted();
                    }),
                  )
                }
              >
                <Trash2 />
                {t("presentations.delete")}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <LinkDialog
        state={link}
        onClose={() => setLink(null)}
        token={token}
        docId={doc.id}
        title={doc.title}
        locales={locales}
        defaultLocale={primary}
        onCreated={(out) => {
          remember(out);
          changed();
        }}
      />

      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[92vh] max-w-[96vw] flex-col gap-3 p-3 sm:max-w-[min(1400px,96vw)]">
          <div className="flex items-center gap-3 pe-8">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm">{doc.title || t("notes.untitled")}</DialogTitle>
            {locales.length > 1 ? (
              <Segmented<PLocale>
                label={t("desk.pres.previewLanguage")}
                value={shownLocale}
                onChange={setPreviewLocale}
                options={locales.map((l) => ({ value: l, label: f.language(l) }))}
              />
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
            <PresentationPreview key={`full:${doc.id}:${shownLocale}:${doc.updated_at}`} token={token} doc={doc} locale={shownLocale} fill />
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        confirmLabel={confirm?.label ?? ""}
        destructive
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          c?.run();
        }}
        onCancel={() => setConfirm(null)}
      />
    </Pane>
  );
}

function Pane({ header, onClose, children }: { header?: ReactNode; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-grid-bg">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        {header ?? <span className="flex-1" />}
        <Button variant="ghost" size="icon-sm" aria-label={t("desk.pres.close")} title={t("desk.pres.close")} onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="grid-hatch flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-md border border-line bg-grid-card p-4">{children}</div>;
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="grid-micro text-grid-muted">{label}</span>
      {children}
    </div>
  );
}

function Meta({ items }: { items: (string | null | undefined)[] }) {
  const list = items.filter(Boolean) as string[];
  return <p className="text-xs text-grid-muted">{list.join(" · ")}</p>;
}

function ShareItem({ share, url, canWrite, busy, onReissue, onRevoke }: {
  share: Share;
  url: string;
  canWrite: boolean;
  busy: boolean;
  onReissue: () => void;
  onRevoke: () => void;
}) {
  const { t } = useI18n();
  const f = useFormat();
  const state = shareState(share);
  const active = state === "active";
  const viewed = f.ago(share.last_viewed_at);
  return (
    <li className={cn("flex flex-col gap-1.5 py-3", !active && "opacity-60")}>
      <div className="flex items-center gap-2">
        <Link2 className={cn("size-4 shrink-0", active ? "text-grid-gold" : "text-grid-muted")} strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate text-sm text-grid-fg" style={{ unicodeBidi: "plaintext" }}>
          {share.label === PREVIEW_LABEL ? t("presentations.share.previewLabel") : share.label || t("presentations.share.unnamed")}
        </span>
        <Chip>{f.short(share.locale)}</Chip>
        <Chip tone={state === "active" ? "ok" : state === "revoked" ? "danger" : "muted"}>{t(`presentations.share.state.${state}`)}</Chip>
      </div>
      <Meta
        items={[
          t("presentations.sum.views", { n: share.view_count }),
          t("presentations.sum.downloads", { n: share.download_count }),
          viewed ? t("presentations.sum.lastViewed", { when: viewed }) : null,
          active ? f.expiry(share.expires_at) : null,
        ]}
      />
      {active && url ? (
        <p dir="ltr" className="truncate text-start font-mono text-[11px] text-grid-body select-text">
          {url.replace(/^https?:\/\//, "")}
        </p>
      ) : null}
      {active && !url ? (
        <p className="flex items-start gap-2 text-xs text-grid-muted">
          <KeyRound className="mt-px size-3.5 shrink-0" />
          {canWrite ? t("presentations.share.sealed") : t("presentations.share.sealedReader")}
        </p>
      ) : null}
      {active ? (
        <div className="-ms-2 flex flex-wrap items-center gap-1">
          {url ? (
            <>
              <Button variant="ghost" size="xs" onClick={() => void bridge().writeClipboardText(url).then(() => toast.success(t("kit.copied")))}>
                <Copy />
                {t("presentations.share.copy")}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => void bridge().openExternal(url)}>
                <Eye />
                {t("presentations.share.openShort")}
              </Button>
            </>
          ) : null}
          {canWrite ? (
            <>
              <Button variant="ghost" size="xs" disabled={busy} onClick={onReissue} className={cn(!url && "text-grid-action")}>
                {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {busy ? t("presentations.working") : t("presentations.share.reissue")}
              </Button>
              <Button variant="ghost" size="xs" disabled={busy} onClick={onRevoke} className="text-grid-danger">
                {t("presentations.share.revoke")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
