import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Archive, ArrowLeft, Pin, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { Button, Field, Header, Screen, StatePanel } from "@/components/ui";
import { ApiError, zekraApi, type Note } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { usePalette } from "@/theme";

export default function NoteScreen() {
  const p = usePalette();
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (!note.data) return;
    setTitle(note.data.title); setBody(note.data.body || ""); setTags(note.data.tags.join(", "));
    setCategory(note.data.category || "note"); setPinned(note.data.pinned); setArchived(note.data.archived);
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
        setError("This note changed elsewhere. Reload it before saving again.");
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
    Alert.alert("Delete note?", "Zekra keeps its version history, but the note will disappear from your active list.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(note.data!) },
    ]);
  }

  const back = <Pressable onPress={() => router.back()} style={styles.headerButton}><ArrowLeft color={p.ink} size={24} /></Pressable>;
  if (note.isLoading) return <Screen><Header title="Note" action={back} /><StatePanel loading title="Loading note" /></Screen>;
  if (note.error || !note.data) return <Screen><Header title="Note" action={back} /><StatePanel title="Could not open note" body={note.error?.message || "Note not found"} /></Screen>;
  const canWrite = brains.find((brain) => brain.namespace === note.data.namespace)?.canWrite ?? false;

  return (
    <Screen>
      <Header title={note.data.title || "Untitled"} eyebrow={note.data.namespace} action={back} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="Untitled" editable={canWrite} />
          <Field label="Body / Markdown" value={body} onChangeText={setBody} multiline placeholder="Write what matters..." editable={canWrite} style={styles.body} />
          <View style={styles.twoColumns}>
            <View style={{ flex: 1 }}><Field label="Category" value={category} onChangeText={setCategory} autoCapitalize="none" editable={canWrite} /></View>
            <View style={{ flex: 1 }}><Field label="Tags" value={tags} onChangeText={setTags} autoCapitalize="none" placeholder="idea, work" editable={canWrite} /></View>
          </View>
          <View style={[styles.toggleRow, { borderColor: p.line, backgroundColor: p.card }]}>
            <Pin color={p.gold} size={19} /><Text style={[styles.toggleLabel, { color: p.ink }]}>Pinned</Text>
            <Switch value={pinned} onValueChange={setPinned} disabled={!canWrite} trackColor={{ true: p.action }} />
          </View>
          <View style={[styles.toggleRow, { borderColor: p.line, backgroundColor: p.card }]}>
            <Archive color={p.muted} size={19} /><Text style={[styles.toggleLabel, { color: p.ink }]}>Archived</Text>
            <Switch value={archived} onValueChange={setArchived} disabled={!canWrite} trackColor={{ true: p.action }} />
          </View>
          <Text style={[styles.index, { color: note.data.indexError ? p.danger : p.muted }]}>
            {note.data.indexed ? `${note.data.chunks} indexed memory chunk${note.data.chunks === 1 ? "" : "s"}` : note.data.indexError || "Indexing into the brain..."}
          </Text>
          {error ? <Text style={{ color: p.danger }}>{error}</Text> : null}
          {canWrite ? <Button label="Save note" loading={save.isPending} onPress={() => save.mutate(note.data!)} /> : <Text style={{ color: p.muted }}>You have read-only access to this brain.</Text>}
          {canWrite ? <Button label="Delete note" tone="danger" loading={remove.isPending} onPress={confirmDelete} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  form: { padding: 18, gap: 15, paddingBottom: 50 },
  body: { minHeight: 270, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 14, lineHeight: 21 },
  twoColumns: { flexDirection: "row", gap: 10 },
  toggleRow: { minHeight: 50, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, gap: 10, borderWidth: 1, borderRadius: 0 },
  toggleLabel: { flex: 1, fontWeight: "600" },
  index: { fontSize: 12, textAlign: "center" },
});
