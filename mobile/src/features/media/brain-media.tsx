import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Camera, FileText, Image as ImageIcon, Music, TriangleAlert, Video } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Image, Pressable, StyleSheet, View } from "react-native";

import { Chip, FilterStrip, ForwardChevron, QueryStatus, Tile, toast, useQueryRefresh } from "@/components/kit";
import { AppText, Cell, Row, SecondaryButton, ltr } from "@/components/ui";
import { useFormat } from "@/features/presentations/parts";
import { ApiError, type Brain } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

import { fileHeaders, mediaApi, mediaFileUrl, mediaListKey, uploadMedia } from "./api";
import { pickDocument, pickFromLibrary, takePhoto, type PickResult } from "./capture";
import { KINDS, countByKind, formatBytes, isBusy, listInterval, statusTone } from "./media-core";
import type { Media, MediaKind } from "./types";

type KindFilter = MediaKind | "all";

/** image = Image, pdf = FileText, video = Video, audio = Music. */
export function MediaKindIcon({ kind, size = 18, color }: { kind: string; size?: number; color?: string }) {
  const p = usePalette();
  const Icon = kind === "pdf" ? FileText : kind === "video" ? Video : kind === "audio" ? Music : ImageIcon;
  return <Icon size={size} color={color ?? p.body} strokeWidth={1.6} />;
}

/** A thumbnail for images (the file needs the bearer), the kind icon otherwise. */
export function MediaThumb({ m, size = 44 }: { m: Media; size?: number }) {
  const { token } = useAuth();
  const [broken, setBroken] = useState(false);
  return (
    <Tile size={size} radius={10}>
      {m.kind === "image" && !broken ? (
        <Image
          source={{ uri: mediaFileUrl(m), headers: fileHeaders(token, mediaFileUrl(m)) }}
          onError={() => setBroken(true)}
          style={{ width: size, height: size }}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <MediaKindIcon kind={m.kind} size={Math.round(size * 0.45)} />
      )}
    </Tile>
  );
}

export function MediaStatusChip({ status }: { status: string }) {
  const { t } = useI18n();
  const known = status === "pending" || status === "processing" || status === "done" || status === "failed";
  return <Chip label={(known ? t(`media.status.${status}`) : status).toUpperCase()} tone={statusTone(status)} />;
}

/*
The "Media" tab of a brain — the web console's /b/{ns}/media on the phone:
capture (camera, photo library, Files), the brain's media filtered by kind,
each row with its reading status. The server stores the file, writes its
companion note and reads it (OCR in any script, PDF pages, video keyframes,
speech); the list polls while anything is still being read.
*/
export function BrainMedia({ brain }: { brain: Brain }) {
  const p = usePalette();
  const { t } = useI18n();
  const f = useFormat();
  const { token } = useAuth();
  const client = useQueryClient();
  const [kind, setKind] = useState<KindFilter>("all");
  const [uploading, setUploading] = useState(0);

  const list = useQuery({
    queryKey: [...mediaListKey(token, brain.namespace), kind],
    queryFn: () => mediaApi.list(token!, brain.namespace, kind),
    enabled: !!token,
    placeholderData: (prev) => prev,
    refetchInterval: (q) => listInterval(q.state.data?.items),
  });
  // Counts for the filter strip come from the unfiltered list.
  const all = useQuery({
    queryKey: [...mediaListKey(token, brain.namespace), "all"],
    queryFn: () => mediaApi.list(token!, brain.namespace, "all"),
    enabled: !!token && kind !== "all",
  });
  const refresh = useQueryRefresh(list);
  const items = list.data?.items ?? [];
  const counts = countByKind((kind === "all" ? list.data : all.data)?.items ?? []);

  async function send(result: PickResult) {
    if (!result || !token) return;
    if ("error" in result) {
      toast(result.error === "permission" ? t("media.cameraDenied") : t("media.filesUnavailable"), "danger");
      return;
    }
    if (result.rejected) toast(t("media.rejected", { n: result.rejected }), "danger");
    if (result.tooLarge) toast(t("media.tooLarge", { n: result.tooLarge }), "danger");
    if (!result.files.length) return;
    setUploading((n) => n + result.files.length);
    for (const file of result.files) {
      try {
        const { media, duplicate } = await uploadMedia(token, brain.namespace, file);
        toast(duplicate ? t("media.duplicate", { name: media.name }) : t("media.uploaded"), "ok");
      } catch (err) {
        const reason = err instanceof ApiError && err.status ? err.message : t("kit.offline");
        toast(`${t("media.uploadFailed", { name: file.name })}\n${reason}`, "danger");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    void client.invalidateQueries({ queryKey: mediaListKey(token, brain.namespace) });
    void client.invalidateQueries({ queryKey: ["notes"] });
  }

  const header = (
    <View style={{ paddingTop: 12, gap: 10 }}>
      <Row>
        <AppText variant="meta">{t("media.intro")}</AppText>
        {brain.canWrite ? (
          <View style={styles.capture}>
            <SecondaryButton
              style={styles.captureBtn}
              label={t("media.capture.camera")}
              icon={<Camera size={17} color={p.ink} strokeWidth={1.7} />}
              onPress={() => void takePhoto().then(send)}
            />
            <SecondaryButton
              style={styles.captureBtn}
              label={t("media.capture.library")}
              icon={<ImageIcon size={17} color={p.ink} strokeWidth={1.7} />}
              onPress={() => void pickFromLibrary().then(send)}
            />
            <SecondaryButton
              style={styles.captureBtn}
              label={t("media.capture.files")}
              icon={<FileText size={17} color={p.ink} strokeWidth={1.7} />}
              onPress={() => void pickDocument().then(send)}
            />
          </View>
        ) : (
          <AppText variant="meta">{t("media.capture.readOnly")}</AppText>
        )}
        {uploading > 0 ? <AppText variant="meta" style={{ color: p.action }}>{t("media.uploading", { n: uploading })}</AppText> : null}
        {list.data && !list.data.reader ? (
          <View style={styles.warn}>
            <TriangleAlert size={16} color={p.danger} strokeWidth={1.8} />
            <AppText variant="meta" style={{ flex: 1, color: p.ink }}>{t("media.noReader")}</AppText>
          </View>
        ) : null}
      </Row>
      <FilterStrip<KindFilter>
        value={kind}
        onChange={setKind}
        options={[
          { value: "all", label: t("media.all") },
          ...KINDS.map((k) => ({ value: k, label: t(`media.kind.${k}`), count: counts[k] || undefined })),
        ]}
      />
      <QueryStatus
        q={list}
        empty={!list.isPending && !list.error && items.length === 0}
        emptyText={kind === "all" ? t("media.empty") : t("media.emptyFiltered")}
      />
    </View>
  );

  return (
    <FlatList
      showsVerticalScrollIndicator={false}
      data={list.error ? [] : items}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      renderItem={({ item, index }) => (
        <Cell first={index === 0} last={index === items.length - 1} dividerInset={metrics.padX + 44 + 13}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/media/[id]", params: { id: item.id } })}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.selected }]}
          >
            <MediaThumb m={item} />
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="rowTitle" numberOfLines={1}>{item.name}</AppText>
              <View style={styles.meta}>
                <MediaStatusChip status={item.status} />
                <AppText variant="meta" numberOfLines={1}>
                  {[t(`media.kind.${item.kind}`), ltr(formatBytes(item.bytes)), isBusy(item.status) ? "" : f.ago(item.createdAt)].filter(Boolean).join(" · ")}
                </AppText>
              </View>
            </View>
            <ForwardChevron />
          </Pressable>
        </Cell>
      )}
      contentContainerStyle={{ paddingBottom: metrics.gap * 2 }}
      refreshControl={refresh}
    />
  );
}

const styles = StyleSheet.create({
  capture: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  captureBtn: { flexGrow: 1, flexBasis: 0, minWidth: 96 },
  warn: { flexDirection: "row", alignItems: "center", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: metrics.padX, paddingVertical: 11 },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
});
