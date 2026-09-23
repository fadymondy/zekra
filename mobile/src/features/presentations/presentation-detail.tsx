import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { Download, ExternalLink, Eye, KeyRound, Languages, Link2, Plus, Share2 } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { AwaitNote, Chip, ErrorLine, ListItem, Meta, QueryStatus, StackHeader, TextButton, Tile, toast, useQueryRefresh } from "@/components/kit";
import { AppText, IconButton, PrimaryButton, Row, Screen, SecondaryButton, Segmented } from "@/components/ui";
import { API_URL, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, usePalette } from "@/theme";

import { presentationsApi } from "./api";
import { copyText, downloadAndShare, openInBrowser, shareLink } from "./files";
import { LinkSheet, type LinkSheetMode } from "./link-sheet";
import { KindTile, LocaleChips, StatusChip, useFormat } from "./parts";
import {
  PREVIEW_DAYS,
  PREVIEW_LABEL,
  STATUSES,
  customerLine,
  downloadVia,
  editUrl,
  errorMessages,
  knownUrl,
  missingLocale,
  orderedLocales,
  previewUrl,
  shareState,
  sortShares,
  webOriginFrom,
} from "./presentations-core";
import { PreviewModal } from "./preview-modal";
import type { Detail, PLocale, PStatus, Share, ShareCreated } from "./types";

/*
A presentation on mobile (MH-369): what it is and who it is for, a preview of
the rendered document (the public share page in a WebView), its share links,
file exports, status, translation and delete. Slide content is edited on the
web console; this screen links there.
*/

// Share addresses this app session has seen for links whose token the server
// cannot show again (not recoverable). Keyed by share id; kept across screen
// mounts so leaving and coming back does not lose a just-made link.
const SESSION_URLS: Record<string, string> = {};

const WEB_ORIGIN = webOriginFrom(API_URL);

function message(err: unknown, fallback: string) {
  if (err instanceof ApiError) return errorMessages(err.payload, err.message || fallback).join("\n");
  return err instanceof Error ? err.message : fallback;
}

export function PresentationDetail({ id }: { id: string }) {
  const p = usePalette();
  const { t, locale } = useI18n();
  const f = useFormat();
  const { token } = useAuth();
  const { brains } = useBrains();
  const client = useQueryClient();
  const key = ["presentation", token, id] as const;
  const q = useQuery({ queryKey: key, queryFn: () => presentationsApi.get(token!, id), enabled: !!token && !!id });
  const refresh = useQueryRefresh(q);

  const [urls, setUrls] = useState<Record<string, string>>(() => ({ ...SESSION_URLS }));
  const [linkSheet, setLinkSheet] = useState<LinkSheetMode | null>(null);
  const [preview, setPreview] = useState<{ url: string } | null>(null);
  const [dlLocale, setDlLocale] = useState<PLocale | null>(null);
  const [exported, setExported] = useState<Record<string, Record<string, string>>>({});
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [translateError, setTranslateError] = useState("");

  const doc = q.data;
  const canWrite = doc ? brains.find((b) => b.namespace === doc.namespace)?.canWrite ?? false : false;

  const remember = (created: ShareCreated) => {
    SESSION_URLS[created.share.id] = created.url;
    setUrls((m) => ({ ...m, [created.share.id]: created.url }));
  };
  const changed = (next?: Detail) => {
    if (next) client.setQueryData(key, next);
    else void q.refetch();
    void client.invalidateQueries({ queryKey: ["presentations"] });
  };

  const setStatus = useMutation({
    mutationFn: (status: PStatus) => presentationsApi.update(token!, id, { status }),
    onSuccess: (next) => { changed(next); toast(t("presentations.saved"), "ok"); },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  const translate = useMutation({
    mutationFn: (to: PLocale) => presentationsApi.translate(token!, id, to),
    onMutate: () => setTranslateError(""),
    onSuccess: (next) => { changed(next); toast(t("presentations.translate.done"), "ok"); },
    onError: (err) => {
      const noModel = err instanceof ApiError && (err.code === "no_translator" || err.status === 503);
      setTranslateError(noModel ? t("presentations.translate.noTranslator") : message(err, t("kit.error")));
    },
  });

  const navigation = useNavigation();
  const remove = useMutation({
    mutationFn: () => presentationsApi.remove(token!, id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["presentations"] });
      client.removeQueries({ queryKey: key });
      toast(t("presentations.deleted"), "ok");
      // The delete may finish after the user already left; navigating then
      // would reach no navigator.
      if (!navigation.isFocused()) return;
      if (navigation.canGoBack()) navigation.goBack();
      else router.replace("/brains");
    },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  const reissue = useMutation({
    mutationFn: (s: Share) => presentationsApi.reissue(token!, id, s.id),
    onSuccess: (out) => { remember(out); changed(); setLinkSheet({ mode: "result", created: out }); },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  const revoke = useMutation({
    mutationFn: (s: Share) => presentationsApi.revoke(token!, id, s.id),
    onSuccess: () => { changed(); toast(t("presentations.share.revokedToast"), "ok"); },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  const revokeAll = useMutation({
    mutationFn: () => presentationsApi.revokeAll(token!, id),
    onSuccess: () => { changed(); toast(t("presentations.share.revokedToast"), "ok"); },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  if (!doc) {
    return (
      <Screen header={<StackHeader title={t("brain.tab.presentations")} />}>
        <View style={{ paddingTop: metrics.gap }}>
          <QueryStatus
            q={q}
            empty={!q.isPending && !q.error}
            emptyText={t("presentations.detail.missing")}
          />
        </View>
      </Screen>
    );
  }

  const locales = orderedLocales(doc.locales);
  const primary: PLocale = locales.includes(doc.locale as PLocale) ? (doc.locale as PLocale) : locales[0] ?? "en";
  const shares = sortShares(doc.shares ?? []);
  const activeCount = shares.filter((s) => shareState(s) === "active").length;
  const archived = doc.status === "archived";
  const formats = doc.formats ?? [];
  const missing = missingLocale(doc.locales);
  const fileLocale = dlLocale && locales.includes(dlLocale) ? dlLocale : primary;

  // ── Preview ──
  async function openPreview() {
    if (!token || !doc) return;
    let url = previewUrl(shares, urls, primary, canWrite);
    if (url) {
      setPreview({ url });
      return;
    }
    if (!canWrite) {
      toast(t("presentations.preview.none"), "danger");
      return;
    }
    setPreview({ url: "" });
    try {
      const out = await presentationsApi.share(token, doc.id, { label: PREVIEW_LABEL, locale: primary, expires_in_days: PREVIEW_DAYS });
      remember(out);
      changed();
      url = out.url;
      setPreview({ url });
    } catch (err) {
      setPreview(null);
      toast(message(err, t("kit.error")), "danger");
    }
  }

  // ── Downloads ──
  async function fileUrl(format: string): Promise<string> {
    const via = downloadVia(shares, urls, fileLocale, format);
    if (via) return via;
    if (exported[fileLocale]?.[format]) return exported[fileLocale][format];
    if (!canWrite || !token || !doc) return "";
    // The server picks a copyable link for the language or makes a 7-day "export" link.
    const out = await presentationsApi.export(token, doc.id, fileLocale);
    setExported((m) => ({ ...m, [fileLocale]: out.customer_downloads }));
    if (out.created_link) changed();
    return out.customer_downloads[format] ?? "";
  }

  async function onFile(format: string, how: "open" | "share") {
    setBusyFile(`${format}:${how}`);
    try {
      const url = await fileUrl(format);
      if (!url) {
        toast(t("presentations.dl.none"), "danger");
        return;
      }
      if (how === "open") await openInBrowser(url);
      else await downloadAndShare(url, doc!.title || "presentation", fileLocale, format);
    } catch (err) {
      toast(message(err, t("presentations.dl.failed")), "danger");
    } finally {
      setBusyFile(null);
    }
  }

  // ── Confirmations ──
  const confirm = (title: string, body: string, action: string, run: () => void) =>
    Alert.alert(title, body, [
      { text: t("common.cancel"), style: "cancel" },
      { text: action, style: "destructive", onPress: run },
    ]);

  const viewed = f.ago(doc.last_viewed_at);

  return (
    <Screen
      scroll
      refreshControl={refresh}
      header={
        <StackHeader
          title={doc.title || t("common.untitled")}
          subtitle={`${f.kind(doc.kind)} · ${f.status(doc.status)}`.toUpperCase()}
          leading={<KindTile kind={doc.kind} size={34} />}
        />
      }
    >
      <View style={styles.stack}>
        {/* Summary */}
        <Row>
          <Micro>{t("presentations.section.summary")}</Micro>
          <KV label={t("presentations.sum.customer")}>
            <AppText variant="body" style={{ color: p.ink }} numberOfLines={2}>{customerLine(doc.customer) || "—"}</AppText>
            {doc.customer?.email ? <AppText variant="meta" style={{ writingDirection: "ltr" }}>{doc.customer.email}</AppText> : null}
          </KV>
          <KV label={t("presentations.sum.languages")}>
            <View style={styles.chips}>
              <LocaleChips locales={doc.locales} />
              <StatusChip status={doc.status} />
              {doc.kind === "page" && doc.style ? <Chip label={f.style(doc.style).toUpperCase()} /> : null}
            </View>
          </KV>
          <Meta
            items={[
              t("presentations.sum.views", { n: doc.view_count }),
              t("presentations.sum.downloads", { n: doc.download_count }),
              t("presentations.sum.links", { n: activeCount }),
            ]}
          />
          <Meta
            items={[
              viewed ? t("presentations.sum.lastViewed", { when: viewed }) : t("presentations.neverViewed"),
              t("presentations.sum.updated", { when: f.ago(doc.updated_at) }),
            ]}
          />
        </Row>

        {/* Preview */}
        <Row>
          <Micro>{t("presentations.section.preview")}</Micro>
          {archived ? (
            <AwaitNote text={t("presentations.archivedNote")} />
          ) : (
            <>
              <PrimaryButton
                label={t("presentations.preview.open")}
                icon={<Eye size={17} color={p.onAction} strokeWidth={1.8} />}
                onPress={() => void openPreview()}
              />
              <AppText variant="meta">{canWrite ? t("presentations.preview.help") : t("presentations.preview.helpReader")}</AppText>
            </>
          )}
        </Row>

        {/* Share links */}
        <Row>
          <View style={styles.sectionHead}>
            <View style={{ flex: 1 }}><Micro>{t("presentations.section.links")}</Micro></View>
            {canWrite && !archived && locales.length ? (
              <TextButton label={t("presentations.share.new")} onPress={() => setLinkSheet({ mode: "new" })} />
            ) : null}
          </View>
          {shares.length === 0 ? <AwaitNote text={t("presentations.share.none")} /> : null}
          {shares.map((s, i) => (
            <ShareItem
              key={s.id}
              share={s}
              url={knownUrl(s, urls)}
              last={i === shares.length - 1}
              canWrite={canWrite}
              busy={(reissue.isPending && reissue.variables?.id === s.id) || (revoke.isPending && revoke.variables?.id === s.id)}
              onReissue={() => confirm(t("presentations.share.reissueConfirm"), t("presentations.share.reissueBody"), t("presentations.share.reissue"), () => reissue.mutate(s))}
              onRevoke={() => confirm(t("presentations.share.revokeConfirm"), t("presentations.share.revokeBody"), t("presentations.share.revoke"), () => revoke.mutate(s))}
            />
          ))}
          {canWrite && !archived && locales.length && shares.length === 0 ? (
            <SecondaryButton
              label={t("presentations.share.new")}
              icon={<Plus size={16} color={p.ink} strokeWidth={1.6} />}
              onPress={() => setLinkSheet({ mode: "new" })}
            />
          ) : null}
        </Row>

        {/* Downloads */}
        {formats.length ? (
          <Row>
            <Micro>{t("presentations.section.downloads")}</Micro>
            {archived ? (
              <AwaitNote text={t("presentations.archivedNote")} />
            ) : (
              <>
                {locales.length > 1 ? (
                  <Segmented<PLocale> value={fileLocale} onChange={setDlLocale} options={locales.map((l) => ({ value: l, label: f.language(l) }))} />
                ) : null}
                <View>
                  {formats.map((fmt, i) => (
                    <ListItem
                      key={fmt}
                      last={i === formats.length - 1}
                      leading={<Tile size={34}><Download size={16} color={p.body} strokeWidth={1.6} /></Tile>}
                      trailing={
                        <View style={styles.trail}>
                          <IconButton label={t("presentations.dl.open")} disabled={!!busyFile} onPress={() => void onFile(fmt, "open")}>
                            <ExternalLink size={17} color={p.muted} strokeWidth={1.6} />
                          </IconButton>
                          <IconButton label={t("presentations.dl.shareFile")} disabled={!!busyFile} onPress={() => void onFile(fmt, "share")}>
                            <Share2 size={17} color={busyFile?.startsWith(`${fmt}:`) ? p.action : p.muted} strokeWidth={1.6} />
                          </IconButton>
                        </View>
                      }
                    >
                      <AppText variant="rowTitle">{fmt === "docx" ? t("presentations.dl.docx") : t("presentations.dl.pdf")}</AppText>
                      <AppText variant="meta">{f.language(fileLocale)}</AppText>
                    </ListItem>
                  ))}
                </View>
                <AppText variant="meta">{t("presentations.dl.help")}</AppText>
              </>
            )}
          </Row>
        ) : null}

        {/* Status + languages */}
        {canWrite ? (
          <Row>
            <Micro>{t("presentations.section.status")}</Micro>
            <Segmented<PStatus>
              value={(STATUSES as string[]).includes(doc.status) ? (doc.status as PStatus) : "draft"}
              onChange={(s) => { if (s !== doc.status && !setStatus.isPending) setStatus.mutate(s); }}
              options={STATUSES.map((s) => ({ value: s, label: f.status(s) }))}
            />
            <AppText variant="meta">{t("presentations.status.help")}</AppText>
            {missing ? (
              <>
                <SecondaryButton
                  label={t("presentations.translate.action", { lang: f.language(missing) })}
                  icon={<Languages size={16} color={p.ink} strokeWidth={1.6} />}
                  loading={translate.isPending}
                  onPress={() => translate.mutate(missing)}
                />
                <AppText variant="meta">{t("presentations.translate.help")}</AppText>
                {translateError ? <ErrorLine text={translateError} /> : null}
              </>
            ) : null}
          </Row>
        ) : (
          <Row>
            <AwaitNote text={t("common.readOnly")} />
          </Row>
        )}

        {/* Manage */}
        <Row>
          <Micro>{t("presentations.section.manage")}</Micro>
          <SecondaryButton
            label={t("presentations.edit.web")}
            icon={<ExternalLink size={16} color={p.ink} strokeWidth={1.6} />}
            onPress={() => void openInBrowser(editUrl(WEB_ORIGIN, locale, doc.namespace, doc.id))}
          />
          <AppText variant="meta">{t("presentations.edit.help")}</AppText>
          {canWrite && activeCount > 1 ? (
            <SecondaryButton
              tone="danger"
              label={t("presentations.share.revokeAll")}
              loading={revokeAll.isPending}
              onPress={() => confirm(t("presentations.share.revokeAllConfirm"), t("presentations.share.revokeBody"), t("presentations.share.revokeAll"), () => revokeAll.mutate())}
            />
          ) : null}
          {canWrite ? (
            <SecondaryButton
              tone="danger"
              label={t("presentations.delete")}
              loading={remove.isPending}
              onPress={() => confirm(t("presentations.deleteConfirm"), t("presentations.deleteBody"), t("common.delete"), () => remove.mutate())}
            />
          ) : null}
        </Row>
      </View>

      <LinkSheet
        state={linkSheet}
        onClose={() => setLinkSheet(null)}
        docId={doc.id}
        title={doc.title}
        locales={locales}
        defaultLocale={primary}
        onCreated={(out) => { remember(out); changed(); }}
      />
      <PreviewModal
        open={preview !== null}
        onClose={() => setPreview(null)}
        url={preview?.url ?? ""}
        title={doc.title || t("common.untitled")}
        locales={locales}
        initialLocale={primary}
      />
    </Screen>
  );
}

function ShareItem({ share, url, last, canWrite, busy, onReissue, onRevoke }: {
  share: Share;
  url: string;
  last: boolean;
  canWrite: boolean;
  busy: boolean;
  onReissue: () => void;
  onRevoke: () => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const f = useFormat();
  const state = shareState(share);
  const active = state === "active";
  const viewed = f.ago(share.last_viewed_at);
  return (
    <View style={[styles.share, !last && { borderBottomWidth: 1, borderBottomColor: p.soft }, !active && { opacity: 0.6 }]}>
      <View style={styles.shareTop}>
        <Link2 size={15} color={active ? p.action : p.muted} strokeWidth={1.8} />
        <AppText variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
          {share.label === PREVIEW_LABEL ? t("presentations.share.previewLabel") : share.label || t("presentations.share.unnamed")}
        </AppText>
        <Chip label={t(`presentations.locale.short.${share.locale === "ar" ? "ar" : "en"}`)} />
        <Chip
          label={t(`presentations.share.state.${state}`).toUpperCase()}
          tone={state === "active" ? "ok" : state === "revoked" ? "danger" : "muted"}
        />
      </View>
      <Meta
        items={[
          t("presentations.sum.views", { n: share.view_count }),
          t("presentations.sum.downloads", { n: share.download_count }),
          viewed ? t("presentations.sum.lastViewed", { when: viewed }) : null,
          active ? f.expiry(share.expires_at) : null,
        ]}
      />
      {active && url ? (
        <AppText numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12.5, color: p.body, writingDirection: "ltr", textAlign: "left" }}>
          {url.replace(/^https?:\/\//, "")}
        </AppText>
      ) : null}
      {active && !url ? (
        <View style={styles.sealed}>
          <KeyRound size={14} color={p.muted} strokeWidth={1.8} />
          <AppText variant="meta" style={{ flex: 1 }}>
            {canWrite ? t("presentations.share.sealed") : t("presentations.share.sealedReader")}
          </AppText>
        </View>
      ) : null}
      {active ? (
        <View style={styles.shareActions}>
          {url ? (
            <>
              <TextButton label={t("presentations.share.copy")} onPress={() => void copyText(url).then(() => toast(t("kit.copied"), "ok"))} />
              <TextButton label={t("presentations.share.share")} onPress={() => void shareLink(url).catch(() => undefined)} />
              <TextButton label={t("presentations.share.openShort")} onPress={() => void openInBrowser(url)} />
            </>
          ) : null}
          {canWrite ? (
            <>
              <TextButton label={busy ? t("presentations.working") : t("presentations.share.reissue")} tone={url ? undefined : "action"} muted={!!url} onPress={busy ? undefined : onReissue} />
              <TextButton label={t("presentations.share.revoke")} tone="danger" onPress={busy ? undefined : onRevoke} />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Micro({ children }: { children: string }) {
  return <AppText variant="micro">{children.toUpperCase()}</AppText>;
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="micro">{label.toUpperCase()}</AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: metrics.gap, paddingTop: metrics.gap },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sectionHead: { flexDirection: "row", alignItems: "center", minHeight: 24, marginVertical: -10 },
  trail: { flexDirection: "row", gap: 8 },
  share: { paddingVertical: 12, gap: 6 },
  shareTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  sealed: { flexDirection: "row", alignItems: "center", gap: 8 },
  shareActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", marginStart: -8, marginVertical: -6 },
});
