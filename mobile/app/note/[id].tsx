import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Archive, ArrowLeft, Pin } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { ImageInsertButton } from "@/components/image-insert";
import { MarkdownView } from "@/components/markdown-view";
import { AppText, Field, Header, PrimaryButton, Screen, SecondaryButton, Segmented, StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { ApiError, zekraApi, type Note } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { metrics, usePalette } from "@/theme";

// Note types mirror the categories the brain indexes against; `category` is a
// free string server-side, so these are the common presets plus whatever the
// note already carries.
const TYPES = ["note", "idea", "task", "decision", "reference", "person", "meeting"];

export default function NoteScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const { brains } = useBrains();
  const client = useQueryClient();
  const note = useQuery({ queryKey: ["note", token, id], queryFn: () => zekraApi.note(token!, id), enabled: !!token && !!id });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [category, setCategory] = useState("note");
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!note.data) return;
    setTitle(note.data.title); setBody(note.data.body || ""); setTags(note.data.tags.join(", "));
    setCategory(note.data.category || "note"); setPinned(note.data.pinned); setArchived(note.data.archived);
    setMode(note.data.body ? "preview" : "edit");
  }, [note.data]);

  const save = useMutation({
    mutationFn: (currentNote: Note) => zekraApi.updateNote(token!, currentNote, {
      title, body, category: category.trim() || "note", tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), pinned, archived,
    }),
    onSuccess: (saved) => {
      client.setQueryData(["note", token, id], saved);
      void client.invalidateQueries({ queryKey: ["notes"] });
      setError("");
      router.back();
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.status === 409) {
        setError(t("note.conflict"));
        void note.refetch();
      } else setError(caught instanceof Error ? caught.message : "Could not save note");
    },
  });

  const remove = useMutation({
    mutationFn: (currentNote: Note) => zekraApi.deleteNote(token!, currentNote),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["notes"] }); router.back(); },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "Could not delete note"),
  });

  function confirmDelete() {
    if (!note.data) return;
    Alert.alert(t("note.deleteConfirm"), t("note.deleteBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => remove.mutate(note.data!) },
    ]);
  }

  const back = <Pressable onPress={() => router.back()} style={styles.headerButton}><ArrowLeft color={p.ink} size={24} /></Pressable>;
  if (note.isLoading) return <Screen><Header title={t("nav.notes")} actions={back} /><StatePanel loading title={t("note.loading")} /></Screen>;
  if (note.error || !note.data) return <Screen><Header title={t("nav.notes")} actions={back} /><StatePanel title={t("note.notFound")} body={note.error?.message} /></Screen>;
  const canWrite = brains.find((brain) => brain.namespace === note.data.namespace)?.canWrite ?? false;
  const types = TYPES.includes(category) ? TYPES : [category, ...TYPES];

  return (
    <Screen>
      <Header title={note.data.title || t("common.untitled")} eyebrow={note.data.namespace} actions={back} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
          <Field label={t("note.titleLabel")} value={title} onChangeText={setTitle} placeholder={t("common.untitled")} editable={canWrite} />

          <View>
            <View style={styles.bodyHeader}>
              <Text style={[styles.label, { color: p.muted }]}>{t("note.body").toUpperCase()}</Text>
              {canWrite ? (
                <View style={styles.tabsWrap}>
                  <Segmented
                    value={mode}
                    onChange={setMode}
                    options={[{ value: "edit", label: t("note.edit") }, { value: "preview", label: t("note.preview") }]}
                  />
                </View>
              ) : null}
            </View>
            {mode === "edit" || !canWrite ? (
              <>
                <Field value={body} onChangeText={setBody} multiline placeholder={t("note.writePlaceholder")} editable={canWrite} style={styles.body} />
                {canWrite ? (
                  // Appends rather than inserting at the caret: RN's TextInput
                  // does not report a caret position we can rely on across
                  // platforms, and a wrong insertion point would split a line.
                  <View style={styles.imageRow}>
                    <ImageInsertButton
                      token={token!}
                      namespace={note.data.namespace}
                      onInsert={(markdown) => setBody((current) => current + markdown)}
                    />
                  </View>
                ) : null}
              </>
            ) : (
              <Pressable onPress={() => canWrite && setMode("edit")} style={[styles.preview, { borderColor: p.line, backgroundColor: p.card }]}>
                <MarkdownView text={body} palette={p} />
              </Pressable>
            )}
          </View>

          <View>
            <Text style={[styles.label, { color: p.muted, marginBottom: 7 }]}>{t("note.type").toUpperCase()}</Text>
            <View style={styles.typeRow}>
              {types.map((type) => {
                const active = type === category;
                return (
                  <Pressable
                    key={type}
                    disabled={!canWrite}
                    onPress={() => setCategory(type)}
                    style={[styles.type, { borderColor: active ? p.action : p.line, backgroundColor: active ? p.action : p.card }]}
                  >
                    <Text style={[styles.typeLabel, { color: active ? p.onAction : p.muted }]}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field label={t("note.tags")} value={tags} onChangeText={setTags} autoCapitalize="none" placeholder={t("note.tagsPlaceholder")} editable={canWrite} />

          <View style={[styles.toggleRow, { borderColor: p.line, backgroundColor: p.card }]}>
            <Pin color={p.gold} size={19} /><Text style={[styles.toggleLabel, { color: p.ink }]}>{t("note.pinned")}</Text>
            <Switch value={pinned} onValueChange={setPinned} disabled={!canWrite} trackColor={{ true: p.action }} />
          </View>
          <View style={[styles.toggleRow, { borderColor: p.line, backgroundColor: p.card }]}>
            <Archive color={p.muted} size={19} /><Text style={[styles.toggleLabel, { color: p.ink }]}>{t("note.archived")}</Text>
            <Switch value={archived} onValueChange={setArchived} disabled={!canWrite} trackColor={{ true: p.action }} />
          </View>

          <Text style={[styles.index, { color: note.data.indexError ? p.danger : p.muted }]}>
            {note.data.indexed ? `${note.data.chunks} ${t("note.chunks")}` : note.data.indexError || t("note.indexing")}
          </Text>
          {error ? <Text style={{ color: p.danger }}>{error}</Text> : null}
          {canWrite ? <PrimaryButton label={t("note.save")} loading={save.isPending} onPress={() => save.mutate(note.data!)} /> : <Text style={{ color: p.muted }}>{t("common.readOnly")}</Text>}
          {canWrite ? <SecondaryButton label={t("note.delete")} tone="danger" loading={remove.isPending} onPress={confirmDelete} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  form: { padding: metrics.padX + 2, gap: 15, paddingBottom: 50 },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  bodyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 7, gap: metrics.gap },
  tabsWrap: { width: 170 },
  imageRow: { flexDirection: "row", marginTop: 8 },
  body: { minHeight: 270, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 14, lineHeight: 21 },
  preview: { minHeight: 270, borderWidth: 1, padding: 13 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  type: { borderWidth: 1, borderRadius: 0, paddingHorizontal: 11, paddingVertical: 7 },
  typeLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  toggleRow: { minHeight: 50, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 10, borderWidth: 1, borderRadius: 0 },
  toggleLabel: { flex: 1, fontWeight: "600" },
  index: { fontSize: 12, textAlign: "center" },
});
