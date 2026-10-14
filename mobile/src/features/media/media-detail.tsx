import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router, useNavigation } from "expo-router";
import { Copy, ExternalLink, NotebookText, RotateCcw, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Image, StyleSheet, View } from "react-native";

import { AwaitNote, ErrorLine, Meta, QueryStatus, Spinner, StackHeader, toast, useQueryRefresh } from "@/components/kit";
import { AppText, MicroLabel, Row, Screen, SecondaryButton, ltr } from "@/components/ui";
import { useFormat } from "@/features/presentations/parts";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, usePalette } from "@/theme";

import { fileHeaders, mediaApi, mediaFileUrl, mediaKey } from "./api";
import { MediaKindIcon, MediaStatusChip } from "./brain-media";
import { openMediaFile } from "./files";
import { clock, formatBytes, hasText, isBusy, itemInterval, plainText, readText } from "./media-core";
import type { MediaSegment } from "./types";

function message(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message || fallback;
  return err instanceof Error ? err.message : fallback;
}

/*
One media file on mobile — the web console's /b/{ns}/media/{id}: what it is,
its reading status, an image preview, and the text the reader found (lines of
an image, PDF pages, video keyframes, the speech transcript), all selectable.
The text already lives in the brain as the file's companion note ("Open note");
Copy text, Read again and Delete round it off. Polls while it is being read.
*/
export function MediaDetail({ id }: { id: string }) {
  const p = usePalette();
  const { t } = useI18n();
  const f = useFormat();
  const { token } = useAuth();
  const { brains } = useBrains();
  const client = useQueryClient();
  const navigation = useNavigation();
  const key = mediaKey(token, id);
  const q = useQuery({
    queryKey: key,
    queryFn: () => mediaApi.get(token!, id),
    enabled: !!token && !!id,
    refetchInterval: (query) => itemInterval(query.state.data),
  });
  const refresh = useQueryRefresh(q);
  const [opening, setOpening] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);

  const m = q.data;
  const canWrite = m ? brains.find((b) => b.namespace === m.namespace)?.canWrite ?? false : false;

  const reprocess = useMutation({
    mutationFn: () => mediaApi.reprocess(token!, id),
    onSuccess: (next) => {
      client.setQueryData(key, next);
      void client.invalidateQueries({ queryKey: ["media"] });
      toast(t("media.reprocessing"), "ok");
    },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  const remove = useMutation({
    mutationFn: () => mediaApi.remove(token!, id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["media"] });
      void client.invalidateQueries({ queryKey: ["notes"] });
      client.removeQueries({ queryKey: key });
      toast(t("media.deleted"), "ok");
      // The delete may finish after the user already left; navigating then
      // would reach no navigator.
      if (!navigation.isFocused()) return;
      if (navigation.canGoBack()) navigation.goBack();
      else router.replace("/brains");
    },
    onError: (err) => toast(message(err, t("kit.error")), "danger"),
  });

  if (!m) {
    const gone = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return (
      <Screen header={<StackHeader title={t("brain.tab.media")} />}>
        <View style={{ paddingTop: metrics.gap, paddingHorizontal: gone ? metrics.inset : 0 }}>
          {gone ? <AwaitNote text={t("media.missing")} /> : <QueryStatus q={q} />}
        </View>
      </Screen>
    );
  }

  const read = readText(m);
  const busy = isBusy(m.status);
  const duration = m.result?.duration;

  async function onOpen() {
    if (!token || !m) return;
    setOpening(true);
    try {
      await openMediaFile(token, m);
    } catch (err) {
      toast(message(err, t("kit.error")), "danger");
    } finally {
      setOpening(false);
    }
  }

  async function onCopy() {
    await Clipboard.setStringAsync(plainText(read));
    toast(t("media.copied"), "ok");
  }

  function onDelete() {
    Alert.alert(t("media.deleteTitle"), t("media.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("media.delete"), style: "destructive", onPress: () => remove.mutate() },
    ]);
  }

  const segment = (s: MediaSegment, i: number, label?: string) => (
    <View key={i} style={{ gap: 4 }}>
      {label ? <AppText variant="meta">{label}</AppText> : null}
      <AppText selectable style={[styles.text, { color: p.ink }]}>{s.text.trim()}</AppText>
    </View>
  );
  const at = (s: MediaSegment) => (s.start != null ? ltr(clock(s.start)) : undefined);

  return (
    <Screen
      scroll
      refreshControl={refresh}
      header={
        <StackHeader
          title={m.name}
          subtitle={t(`media.kind.${m.kind}`)}
          leading={<MediaKindIcon kind={m.kind} size={20} color={p.muted} />}
        />
      }
    >
      <View style={{ gap: metrics.gap, paddingBottom: metrics.gap * 2 }}>
        <Row>
          <View style={styles.status}>
            <MediaStatusChip status={m.status} />
            <Meta
              items={[
                ltr(formatBytes(m.bytes)),
                duration ? ltr(clock(duration)) : null,
                t("media.added", { when: f.ago(m.createdAt) }),
              ]}
            />
          </View>
          {m.kind === "image" ? (
            <Image
              source={{ uri: mediaFileUrl(m), headers: fileHeaders(token, mediaFileUrl(m)) }}
              onLoad={(e) => {
                const { width, height } = e.nativeEvent.source;
                if (width && height) setRatio(width / height);
              }}
              style={[styles.preview, { aspectRatio: ratio, backgroundColor: p.field }]}
              resizeMode="contain"
              accessibilityLabel={m.name}
            />
          ) : null}
          <SecondaryButton
            label={t("media.openFile")}
            loading={opening}
            icon={<ExternalLink size={17} color={p.ink} strokeWidth={1.7} />}
            onPress={() => void onOpen()}
          />
        </Row>

        {busy ? (
          <Row>
            <View style={styles.status}>
              <Spinner />
              <AppText variant="meta" style={{ flex: 1 }}>{t("media.reading")}</AppText>
            </View>
          </Row>
        ) : null}

        {m.status === "failed" ? (
          <Row>
            <ErrorLine text={m.error ? `${t("media.failed")} ${m.error}` : t("media.failed")} />
          </Row>
        ) : null}

        {m.status === "done" && !hasText(read) ? (
          <Row>
            <AwaitNote text={t("media.noText")} />
          </Row>
        ) : null}

        {read.lines.length ? (
          <Row>
            <MicroLabel>{t("media.section.lines")}</MicroLabel>
            <AppText selectable style={[styles.text, { color: p.ink }]}>
              {read.lines.map((l) => l.text).join("\n")}
            </AppText>
          </Row>
        ) : null}

        {read.text.length ? (
          <Row>
            <MicroLabel>{m.kind === "video" ? t("media.section.onScreen") : t("media.section.pages")}</MicroLabel>
            {read.text.map((s, i) => segment(s, i, s.kind === "page" && s.page ? t("media.page", { n: s.page }) : at(s)))}
          </Row>
        ) : null}

        {read.speech.length ? (
          <Row>
            <MicroLabel>{t("media.section.transcript")}</MicroLabel>
            {read.speech.map((s, i) => segment(s, i, at(s)))}
          </Row>
        ) : null}

        <Row>
          {m.noteId ? <AppText variant="meta">{t("media.inBrain")}</AppText> : null}
          {m.noteId ? (
            <SecondaryButton
              label={t("media.openNote")}
              icon={<NotebookText size={17} color={p.ink} strokeWidth={1.7} />}
              onPress={() => router.push({ pathname: "/note/[id]", params: { id: m.noteId! } })}
            />
          ) : null}
          {hasText(read) ? (
            <SecondaryButton
              label={t("media.copyText")}
              icon={<Copy size={17} color={p.ink} strokeWidth={1.7} />}
              onPress={() => void onCopy()}
            />
          ) : null}
          {canWrite ? (
            <SecondaryButton
              label={t("media.reprocess")}
              loading={reprocess.isPending}
              disabled={busy}
              icon={<RotateCcw size={17} color={p.ink} strokeWidth={1.7} />}
              onPress={() => reprocess.mutate()}
            />
          ) : null}
          {canWrite ? (
            <SecondaryButton
              label={t("media.delete")}
              tone="danger"
              loading={remove.isPending}
              icon={<Trash2 size={17} color={p.danger} strokeWidth={1.7} />}
              onPress={onDelete}
            />
          ) : null}
        </Row>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  preview: { width: "100%", borderRadius: metrics.radius.card },
  text: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 24 },
});
