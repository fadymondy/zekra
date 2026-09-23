import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { MoreHorizontal } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, BackHandler, Pressable, Share, StyleSheet, TextInput, View } from "react-native";

import { QueryStatus, StackHeader, TextButton, toast } from "@/components/kit";
import { AppText, IconButton, Screen, StatePanel } from "@/components/ui";
import { overwriteNote, saveNote, uploadDataUrlImage } from "@/features/editor/api";
import { Autosaver, type AutosaveStatus, type SaveOutcome } from "@/features/editor/autosave-core";
import type { EngineMode, ToolbarCommand, ToolbarState } from "@/features/editor/bridge-core";
import { exportNote, type ExportFormat } from "@/features/editor/export";
import { NoteEngine, type NoteEngineHandle, type PastedImage } from "@/features/editor/note-engine";
import { ExportSheet, LinkSheet, NoteMenuSheet, ReadingSheet, TagsSheet } from "@/features/editor/note-sheets";
import { EditorToolbar } from "@/features/editor/toolbar";
import { useKeyboardInset } from "@/features/editor/use-keyboard-inset";
import { uploadNoteImage, zekraApi, type Note } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, type, usePalette } from "@/theme";

/*
The note screen (MH-368, MH-367): Apple-Notes style — a title, then the note
itself, always live. No edit/preview toggle: the body is the TipTap engine
(features/editor/note-engine.tsx), which renders as you type; read-only brains
and notes the rich editor would damage get the rendered view instead.

Saving is automatic, 800ms after the last keystroke (as on web), with the
version the edit was based on; also on blur, on leaving, and when the app
goes to the background. A 409 keeps the user's text and asks: reload theirs,
or overwrite.

`/note/new?ns=…` opens an empty editor. Nothing is created until the title or
body has real content — the server rejects empty notes, which is what made
"New note" fail (MH-362) — then the route is re-pointed at the created id and
editing carries on in place.
*/

type Snapshot = { title: string; description: string; body: string; tags: string[] };

const AUTOSAVE_MS = 800;
const DESCRIPTION_MAX = 500;
const DESCRIPTION_LINE = Math.round(type.body * 1.5);

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default function NoteScreen() {
  const params = useLocalSearchParams<{ id: string; ns?: string }>();
  const isNew = params.id === "new";
  const { token } = useAuth();
  const { brains, namespace: currentNs, loading: brainsLoading } = useBrains();
  const client = useQueryClient();
  const p = usePalette();
  const { t, isRtl } = useI18n();

  // The note being edited. For a new note it is null until created, then the
  // created id — kept in state, not read from the route, so re-pointing the
  // route does not remount or reload anything.
  const [noteId, setNoteId] = useState<string | null>(isNew ? null : params.id);
  const query = useQuery({
    queryKey: ["note", noteId],
    queryFn: () => zekraApi.note(token!, noteId!),
    enabled: !!token && !!noteId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // What the editor opened with — set once, never from later query updates,
  // so a background refetch can never overwrite what is being typed.
  const [initial, setInitial] = useState<{ note: Note | null; namespace: string } | null>(
    isNew ? { note: null, namespace: params.ns || currentNs } : null,
  );
  useEffect(() => {
    if (!initial && query.data) setInitial({ note: query.data, namespace: query.data.namespace });
  }, [initial, query.data]);
  useEffect(() => {
    // A new note opened before the brain list restored the current brain.
    if (initial && !initial.note && !initial.namespace && currentNs) setInitial({ note: null, namespace: currentNs });
  }, [initial, currentNs]);

  const namespace = initial?.namespace ?? "";
  const brain = brains.find((b) => b.namespace === namespace);
  const canWrite = brain ? brain.canWrite : isNew;

  if (!initial) {
    return (
      <Screen header={<StackHeader title={t("nav.notes")} />}>
        <QueryStatus q={query} lines={5} />
        {!query.isPending && !query.error ? <StatePanel title={t("note.notFound")} /> : null}
      </Screen>
    );
  }
  if (!namespace) {
    return (
      <Screen header={<StackHeader title={t("editor.newNote")} />}>
        {brainsLoading ? <StatePanel loading title={t("common.loading")} /> : <StatePanel title={t("note.notFound")} />}
      </Screen>
    );
  }

  return (
    <NoteEditor
      key={initial.note?.id ?? "new"}
      initialNote={initial.note}
      namespace={namespace}
      brainName={brain?.displayName || namespace}
      canWrite={canWrite}
      token={token}
      onCreated={(created) => {
        client.setQueryData(["note", created.id], created);
        setNoteId(created.id);
        router.setParams({ id: created.id });
      }}
      isRtl={isRtl}
      palette={p}
    />
  );
}

function NoteEditor({ initialNote, namespace, brainName, canWrite, token, onCreated, isRtl, palette: p }: {
  initialNote: Note | null;
  namespace: string;
  brainName: string;
  canWrite: boolean;
  token: string | null;
  onCreated: (note: Note) => void;
  isRtl: boolean;
  palette: ReturnType<typeof usePalette>;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const engine = useRef<NoteEngineHandle>(null);
  const outer = useRef<View>(null);
  const keyboard = useKeyboardInset(outer);

  const [title, setTitle] = useState(initialNote?.title ?? "");
  // Older servers omit description; missing is "".
  const [description, setDescription] = useState(initialNote?.description ?? "");
  const [tags, setTags] = useState<string[]>(initialNote?.tags ?? []);
  const [pinned, setPinned] = useState(initialNote?.pinned ?? false);
  const [archived, setArchived] = useState(initialNote?.archived ?? false);
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [focused, setFocused] = useState(false);
  const [mode, setMode] = useState<EngineMode | null>(null);
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
  const [uploading, setUploading] = useState(0);
  const [sheet, setSheet] = useState<null | "menu" | "reading" | "tags" | "export" | "link">(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [resolving, setResolving] = useState(false);

  // Refs hold what async work must see NOW, not what it closed over.
  const base = useRef<Note | null>(initialNote);
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const descriptionInput = useRef<TextInput>(null);
  const bodyRef = useRef(initialNote?.body ?? "");
  const tagsRef = useRef(tags);
  const mounted = useRef(true);
  const lastStatus = useRef<AutosaveStatus>("idle");
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const tRef = useRef(t);
  tRef.current = t;

  const snapshot = (): Snapshot => ({ title: titleRef.current, description: descriptionRef.current, body: bodyRef.current, tags: tagsRef.current });

  const invalidateList = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["notes", namespace] });
  }, [client, namespace]);

  const adopt = useCallback(
    (saved: Note) => {
      base.current = saved;
      client.setQueryData(["note", saved.id], saved);
      invalidateList();
    },
    [client, invalidateList],
  );

  const save = useCallback(
    async (snap: Snapshot): Promise<SaveOutcome> => {
      const tk = tokenRef.current;
      if (!tk) return { ok: false, conflict: false, error: "not signed in" };
      if (!base.current) {
        // MH-362: the server rejects an empty note, so a new note is only
        // created once there is something in it.
        if (!snap.title.trim() && !snap.body.trim()) return { ok: true, skipped: true };
        try {
          const created = await zekraApi.createNote(tk, namespace, { title: snap.title, description: snap.description, body: snap.body, tags: snap.tags });
          adopt(created);
          if (mounted.current) onCreatedRef.current(created);
          return { ok: true };
        } catch (e) {
          toast(t("editor.createFailed", { error: errorText(e) }), "danger");
          return { ok: false, conflict: false, error: errorText(e) };
        }
      }
      const result = await saveNote(tk, base.current, { title: snap.title, description: snap.description, body: snap.body, tags: snap.tags });
      if (result.ok) {
        adopt(result.note);
        return { ok: true };
      }
      return { ok: false, conflict: result.conflict, error: result.error };
    },
    [adopt, namespace, t],
  );

  const saverRef = useRef<Autosaver<Snapshot> | null>(null);
  if (!saverRef.current) {
    saverRef.current = new Autosaver<Snapshot>({
      delay: AUTOSAVE_MS,
      save: (snap) => saveRef.current(snap),
      onStatus: (next, error) => {
        // Say it once when saving starts failing, not on every retry.
        if (next === "error" && lastStatus.current !== "error" && base.current) toast(tRef.current("editor.saveFailed", { error }), "danger");
        lastStatus.current = next;
        if (mounted.current) setStatus(next);
      },
    });
  }
  const saver = saverRef.current;
  const saveRef = useRef(save);
  saveRef.current = save;

  const changed = useCallback(() => {
    if (canWrite) saver.change(snapshot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, saver]);

  /** Pull the page's latest body (it debounces), then save everything now. */
  const flushAll = useCallback(async () => {
    if (!canWrite) return;
    const body = await engine.current?.getMarkdown();
    if (typeof body === "string" && body !== bodyRef.current) {
      bodyRef.current = body;
      saver.change(snapshot());
    }
    await saver.flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, saver]);

  // Background / inactive: save now — the OS may kill us next.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flushAll();
    });
    return () => sub.remove();
  }, [flushAll]);

  // Leaving by any route (swipe back included): save what we have.
  useEffect(() => {
    return () => {
      mounted.current = false;
      void saver.flush().finally(() => saver.dispose());
    };
  }, [saver]);

  // The one way out of this screen. Leaving waits for the save, and by then the
  // screen may already be gone (a second tap, a swipe back, a delete) — a
  // router.back() at that point reaches no navigator ("GO_BACK was not
  // handled"). So: one exit at a time, never after unmount, and ask this
  // screen's own navigator whether there is anything to go back to.
  const navigation = useNavigation();
  const leaving = useRef(false);
  const exit = useCallback(() => {
    if (!mounted.current) return;
    if (navigation.canGoBack()) navigation.goBack();
    else router.replace("/brains");
  }, [navigation]);

  const leave = useCallback(async () => {
    if (leaving.current) return;
    leaving.current = true;
    await flushAll();
    const unsaved = saver.inConflict || (saver.isDirty && saver.status === "error");
    if (!unsaved) {
      exit();
      return;
    }
    Alert.alert(t("editor.leaveTitle"), t("editor.leaveBody"), [
      { text: t("editor.stay"), style: "cancel", onPress: () => { leaving.current = false; } },
      { text: t("editor.leave"), style: "destructive", onPress: exit },
    ]);
  }, [exit, flushAll, saver, t]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      void leave();
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  // ─── conflict resolution ────────────────────────────────────────────────
  const reloadTheirs = useCallback(async () => {
    const id = base.current?.id;
    if (!id || !token) return;
    setResolving(true);
    try {
      const server = await zekraApi.note(token, id);
      adopt(server);
      titleRef.current = server.title;
      setTitle(server.title);
      descriptionRef.current = server.description ?? "";
      setDescription(server.description ?? "");
      tagsRef.current = server.tags;
      setTags(server.tags);
      setPinned(server.pinned);
      setArchived(server.archived);
      bodyRef.current = server.body ?? "";
      engine.current?.setMarkdown(server.body ?? "");
      saver.resolved({ dirty: false, snapshot: snapshot() });
    } catch (e) {
      toast(t("editor.actionFailed", { error: errorText(e) }), "danger");
    } finally {
      setResolving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adopt, saver, t, token]);

  const overwrite = useCallback(async () => {
    const id = base.current?.id;
    if (!id || !token) return;
    setResolving(true);
    try {
      const snap = snapshot();
      const saved = await overwriteNote(token, id, snap);
      adopt(saved);
      const now = snapshot();
      const stillDirty = now.title !== snap.title || now.description !== snap.description || now.body !== snap.body || now.tags.join("\u0000") !== snap.tags.join("\u0000");
      saver.resolved({ dirty: stillDirty, snapshot: now });
    } catch (e) {
      toast(t("editor.actionFailed", { error: errorText(e) }), "danger");
    } finally {
      setResolving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adopt, saver, t, token]);

  // ─── menu actions ────────────────────────────────────────────────────────
  /** Pin / archive: saved immediately, after any pending text save so the
   *  two PUTs cannot race on the same version. */
  const patchNow = useCallback(
    async (patch: { pinned?: boolean; archived?: boolean }) => {
      await flushAll();
      if (!base.current || !token) return;
      const result = await saveNote(token, base.current, patch);
      if (result.ok) {
        adopt(result.note);
        setPinned(result.note.pinned);
        setArchived(result.note.archived);
      } else {
        toast(result.conflict ? t("editor.conflictTitle") : t("editor.actionFailed", { error: result.error }), "danger");
      }
    },
    [adopt, flushAll, t, token],
  );

  const confirmDelete = useCallback(() => {
    setSheet(null);
    Alert.alert(t("note.deleteConfirm"), t("note.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            saver.dispose();
            if (!base.current || !token) {
              exit();
              return;
            }
            try {
              await zekraApi.deleteNote(token, base.current);
              client.removeQueries({ queryKey: ["note", base.current.id] });
              invalidateList();
              exit();
            } catch (e) {
              toast(t("editor.actionFailed", { error: errorText(e) }), "danger");
            }
          })();
        },
      },
    ]);
  }, [client, exit, invalidateList, saver, t, token]);

  const runExport = useCallback(
    async (format: ExportFormat) => {
      setExporting(format);
      try {
        await flushAll();
        const body = bodyRef.current;
        const note: Note = base.current
          ? { ...base.current, title: titleRef.current, description: descriptionRef.current, body, tags: tagsRef.current }
          : ({ id: "", namespace, title: titleRef.current, description: descriptionRef.current, body, tags: tagsRef.current } as Note);
        await exportNote(note, format);
        setSheet(null);
      } catch (e) {
        toast(t("editor.exportFailed", { error: errorText(e) }), "danger");
      } finally {
        setExporting(null);
      }
    },
    [flushAll, namespace, t],
  );

  const share = useCallback(async () => {
    setSheet(null);
    try {
      const body = (await engine.current?.getMarkdown()) ?? bodyRef.current;
      const heading = titleRef.current.trim();
      await Share.share({ title: heading || undefined, message: heading ? `${heading}\n\n${body}` : body });
    } catch (e) {
      toast(t("note.shareFailed"), "danger");
    }
  }, [t]);

  // ─── images ──────────────────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    if (!token) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setUploading((n) => n + 1);
      const { url } = await uploadNoteImage(token, namespace, {
        uri: asset.uri,
        name: asset.fileName || "image.jpg",
        // SVG is rejected server-side and the picker cannot return one.
        type: asset.mimeType || "image/jpeg",
      });
      engine.current?.insertImage(url, "");
    } catch (e) {
      toast(`${t("note.imageFailed")}: ${errorText(e)}`, "danger");
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [namespace, t, token]);

  const onPasteImage = useCallback(
    async (image: PastedImage) => {
      if (!token) return;
      setUploading((n) => n + 1);
      try {
        const url = await uploadDataUrlImage(token, namespace, image.dataUrl, image.mime, image.name);
        engine.current?.insertImage(url, "");
      } catch (e) {
        toast(`${t("note.imageFailed")}: ${errorText(e)}`, "danger");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    },
    [namespace, t, token],
  );

  const onCommand = useCallback((command: ToolbarCommand) => engine.current?.exec(command), []);

  // ─── render ──────────────────────────────────────────────────────────────
  const statusLabel = useMemo(() => {
    if (!canWrite) return t("editor.readOnly");
    switch (status) {
      case "saving":
        return t("editor.saving");
      case "saved":
        return t("editor.saved");
      case "dirty":
        return t("editor.unsaved");
      case "error":
      case "conflict":
        return t("editor.notSaved");
      default:
        return base.current ? t("editor.saved") : t("editor.newNote");
    }
  }, [canWrite, status, t]);

  const showToolbar = canWrite && focused && keyboard.visible && (mode === "rich" || mode === "source");

  return (
    <Screen
      header={
        <StackHeader
          title={brainName}
          subtitle={statusLabel.toUpperCase()}
          onBack={() => void leave()}
          trailing={
            <IconButton label={t("editor.more")} onPress={() => setSheet("menu")}>
              <MoreHorizontal size={20} color={p.muted} strokeWidth={1.6} />
            </IconButton>
          }
        />
      }
    >
      <View ref={outer} style={styles.fill} collapsable={false}>
        <View style={[styles.fill, { paddingBottom: keyboard.inset, backgroundColor: p.bg }]}>
          <TextInput
            value={title}
            onChangeText={(v) => {
              titleRef.current = v;
              setTitle(v);
              changed();
            }}
            editable={canWrite}
            // A new note starts in the title; Return moves to the description.
            autoFocus={!initialNote && canWrite}
            placeholder={t("editor.titlePlaceholder")}
            placeholderTextColor={p.muted}
            multiline
            scrollEnabled={false}
            submitBehavior="blurAndSubmit"
            returnKeyType="next"
            onSubmitEditing={() => descriptionInput.current?.focus()}
            onBlur={() => void saver.flush()}
            style={[
              styles.title,
              { fontFamily: fonts.medium },
              { color: p.ink, textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" },
            ]}
            accessibilityLabel={t("note.titleLabel")}
          />

          <TextInput
            ref={descriptionInput}
            value={description}
            onChangeText={(v) => {
              descriptionRef.current = v;
              setDescription(v);
              changed();
            }}
            editable={canWrite}
            placeholder={t("editor.descriptionPlaceholder")}
            placeholderTextColor={p.muted}
            maxLength={DESCRIPTION_MAX}
            // Wraps and grows to three lines, then scrolls; Return moves to the body.
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="next"
            onSubmitEditing={() => engine.current?.focus()}
            onBlur={() => void saver.flush()}
            style={[
              styles.description,
              { fontFamily: fonts.regular },
              { color: p.muted, textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" },
            ]}
            accessibilityLabel={t("editor.descriptionLabel")}
          />

          {tags.length ? (
            <Pressable onPress={canWrite ? () => setSheet("tags") : undefined} style={styles.tags} accessibilityRole={canWrite ? "button" : undefined}>
              {tags.map((tag) => (
                <View key={tag} style={[styles.tag, { borderColor: `${p.gold}55`, backgroundColor: `${p.gold}12` }]}>
                  <AppText style={{ fontFamily: fonts.mono, fontSize: 12.5, color: p.gold }}>#{tag}</AppText>
                </View>
              ))}
            </Pressable>
          ) : null}

          {status === "conflict" ? (
            <View style={[styles.banner, { borderColor: p.gold, backgroundColor: `${p.gold}14` }]}>
              <AppText style={{ fontFamily: fonts.medium, fontSize: 15.5, color: p.ink }}>{t("editor.conflictTitle")}</AppText>
              <AppText variant="meta">{t("editor.conflictBody")}</AppText>
              <View style={styles.bannerActions}>
                <TextButton label={t("editor.reloadTheirs")} onPress={() => !resolving && void reloadTheirs()} />
                <TextButton label={t("editor.overwrite")} tone="danger" onPress={() => !resolving && void overwrite()} />
              </View>
            </View>
          ) : null}

          <NoteEngine
            ref={engine}
            markdown={initialNote?.body ?? ""}
            editable={canWrite}
            autofocus={false}
            onChange={(md) => {
              bodyRef.current = md;
              changed();
            }}
            onFocusChange={(on) => {
              setFocused(on);
              if (!on) void saver.flush();
            }}
            onToolbarState={setToolbar}
            onMode={setMode}
            onPasteImage={(img) => void onPasteImage(img)}
            style={styles.fill}
          />

          {showToolbar ? (
            <EditorToolbar
              state={toolbar}
              mode={mode}
              uploading={uploading > 0}
              onCommand={onCommand}
              onLink={() => setSheet("link")}
              onImage={() => void pickImage()}
              onDone={() => engine.current?.blur()}
            />
          ) : null}
        </View>
      </View>

      <NoteMenuSheet
        open={sheet === "menu"}
        onClose={() => setSheet(null)}
        canWrite={canWrite}
        saved={!!base.current}
        pinned={pinned}
        archived={archived}
        onReading={() => setSheet("reading")}
        onTags={() => setSheet("tags")}
        onPin={() => {
          setSheet(null);
          void patchNow({ pinned: !pinned });
        }}
        onArchive={() => {
          setSheet(null);
          void patchNow({ archived: !archived });
        }}
        onExport={() => setSheet("export")}
        onShare={() => void share()}
        onDelete={confirmDelete}
      />
      <ReadingSheet open={sheet === "reading"} onClose={() => setSheet(null)} />
      <ExportSheet open={sheet === "export"} onClose={() => setSheet(null)} busy={exporting} onPick={(f) => void runExport(f)} />
      <TagsSheet
        open={sheet === "tags"}
        onClose={() => setSheet(null)}
        tags={tags}
        onChange={(next) => {
          tagsRef.current = next;
          setTags(next);
          changed();
        }}
      />
      <LinkSheet
        open={sheet === "link"}
        onClose={() => setSheet(null)}
        initial={toolbar?.link ?? ""}
        onApply={(href) => {
          setSheet(null);
          engine.current?.exec("link", href);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: {
    fontSize: 27,
    lineHeight: 37,
    paddingHorizontal: metrics.padX,
    paddingTop: 18,
    paddingBottom: 6,
    borderWidth: 0,
  },
  description: {
    fontSize: type.body,
    lineHeight: DESCRIPTION_LINE,
    maxHeight: DESCRIPTION_LINE * 3 + 6,
    paddingHorizontal: metrics.padX,
    paddingTop: 0,
    paddingBottom: 6,
    borderWidth: 0,
  },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: metrics.padX, paddingBottom: 6 },
  tag: { minHeight: 24, paddingHorizontal: 8, borderRadius: metrics.radius.chip, borderWidth: 1, justifyContent: "center" },
  banner: { marginHorizontal: metrics.padX, marginVertical: 6, padding: 12, borderWidth: 1, borderRadius: metrics.radius.control, gap: 4 },
  bannerActions: { flexDirection: "row", gap: 8, marginStart: -8 },
});
