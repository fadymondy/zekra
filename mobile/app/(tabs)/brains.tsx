import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { BrainCircuit, Check, Plus, X } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { Button, Field, Header, Screen, StatePanel } from "@/components/ui";
import { zekraApi, type Brain } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { usePalette } from "@/theme";

export default function BrainsScreen() {
  const p = usePalette();
  const { token } = useAuth();
  const { brains, namespace, select, loading, error, refresh } = useBrains();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function create() {
    if (!token) return;
    setSaving(true); setFormError("");
    try {
      await zekraApi.createBrain(token, { namespace: name.trim().toLowerCase(), displayName: displayName.trim() || undefined, description: description.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: ["brains"] });
      await select(name.trim().toLowerCase());
      setOpen(false); setName(""); setDisplayName(""); setDescription("");
      router.push("/(tabs)/notes");
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Could not create brain"); }
    finally { setSaving(false); }
  }

  function renderBrain({ item }: { item: Brain }) {
    const active = item.namespace === namespace;
    return (
      <Pressable
        onPress={() => { void select(item.namespace); router.push("/(tabs)/notes"); }}
        style={({ pressed }) => [styles.card, { backgroundColor: p.card, borderColor: active ? p.action : p.line, opacity: pressed ? 0.72 : 1 }]}
      >
        <View style={[styles.mark, { backgroundColor: item.colorHex || item.color || p.action }]}>
          <BrainCircuit color="#fff" size={22} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.name, { color: p.ink }]}>{item.displayName || item.namespace}</Text>
            {active ? <Check color={p.action} size={18} /> : null}
          </View>
          <Text numberOfLines={1} style={[styles.namespace, { color: p.muted }]}>{item.namespace} · {item.role}</Text>
          {item.description ? <Text numberOfLines={2} style={[styles.description, { color: p.body }]}>{item.description}</Text> : null}
          <Text style={[styles.stats, { color: p.muted }]}>{item.memories.toLocaleString()} memories · {item.canWrite ? "write access" : "read only"}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Screen>
      <Header title="Brains" eyebrow="Your knowledge spaces" action={<Pressable onPress={() => setOpen(true)} style={[styles.iconButton, { backgroundColor: p.action }]}><Plus color={p.onAction} size={22} /></Pressable>} />
      {loading ? <StatePanel loading title="Loading brains" /> : error ? <StatePanel title="Could not load brains" body={error.message} /> : (
        <FlatList
          data={brains}
          keyExtractor={(item) => item.namespace}
          renderItem={renderBrain}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={p.action} />}
          ListEmptyComponent={<StatePanel title="No brains yet" body="Create one to start capturing notes and connected knowledge." />}
        />
      )}
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <Screen>
          <Header title="New brain" eyebrow="Create a knowledge space" action={<Pressable onPress={() => setOpen(false)}><X color={p.ink} size={25} /></Pressable>} />
          <View style={styles.form}>
            <Field label="Brain ID" value={name} onChangeText={setName} autoCapitalize="none" placeholder="product-research" />
            <Text style={[styles.hint, { color: p.muted }]}>Lowercase letters, numbers, dots, dashes, and underscores.</Text>
            <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="Product research" />
            <Field label="Description" value={description} onChangeText={setDescription} multiline placeholder="What belongs in this brain?" />
            {formError ? <Text style={{ color: p.danger }}>{formError}</Text> : null}
            <Button label="Create brain" loading={saving} disabled={!/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(name)} onPress={() => void create()} />
          </View>
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: 14, gap: 10, paddingBottom: 30 },
  card: { borderWidth: 1, borderRadius: 0, padding: 14, flexDirection: "row", gap: 13 },
  mark: { width: 44, height: 44, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: "800" },
  namespace: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4 },
  description: { fontSize: 14, lineHeight: 19 },
  stats: { fontSize: 11, marginTop: 3 },
  iconButton: { width: 42, height: 42, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  form: { padding: 18, gap: 14 },
  hint: { fontSize: 12, marginTop: -8 },
});
