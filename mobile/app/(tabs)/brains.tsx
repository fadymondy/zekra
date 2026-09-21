import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { BrainCircuit, Check, KeyRound, Plus, Trash2, X } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { AppText, Field, Header, PrimaryButton, Screen, StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { zekraApi, type Brain, type Secret } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { metrics, usePalette } from "@/theme";

/** Per-brain secrets vault (GET/POST /api/brain/secrets). Values are write-only
 *  from here — the list returns hints, never the secret itself. */
function VaultSheet({ brain, onClose }: { brain: Brain; onClose: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const secrets = useQuery({
    queryKey: ["secrets", token, brain.namespace],
    queryFn: () => zekraApi.secrets(token!, brain.namespace),
    enabled: !!token,
  });

  async function add() {
    if (!token || !name.trim() || !value) return;
    setSaving(true); setError("");
    try {
      await zekraApi.putSecret(token, brain.namespace, name.trim(), value);
      setName(""); setValue("");
      await client.invalidateQueries({ queryKey: ["secrets", token, brain.namespace] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save secret");
    } finally { setSaving(false); }
  }

  async function remove(secret: Secret) {
    if (!token) return;
    try {
      await zekraApi.deleteSecret(token, brain.namespace, secret.name);
      await client.invalidateQueries({ queryKey: ["secrets", token, brain.namespace] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete secret");
    }
  }

  const list = secrets.data?.secrets ?? [];

  return (
    <Screen>
      <Header
        title={t("vault.title")}
        eyebrow={brain.displayName || brain.namespace}
        actions={<Pressable onPress={onClose}><X color={p.ink} size={25} /></Pressable>}
      />
      {secrets.isLoading ? <StatePanel loading title={t("vault.loading")} /> : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.vaultList}
          ListEmptyComponent={<Text style={[styles.hint, { color: p.muted, paddingHorizontal: metrics.padX }]}>{t("vault.empty")}</Text>}
          renderItem={({ item }) => (
            <View style={[styles.secretRow, { borderColor: p.line, backgroundColor: p.card }]}>
              <KeyRound color={p.gold} size={18} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: p.ink, fontWeight: "700" }}>{item.name}</Text>
                {item.hint ? <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>{item.hint}</Text> : null}
              </View>
              {brain.canWrite ? (
                <Pressable onPress={() => void remove(item)} hitSlop={8}><Trash2 color={p.danger} size={18} /></Pressable>
              ) : null}
            </View>
          )}
          ListFooterComponent={brain.canWrite ? (
            <View style={styles.vaultForm}>
              <Field label={t("vault.name")} value={name} onChangeText={setName} autoCapitalize="none" />
              <Field label={t("vault.value")} value={value} onChangeText={setValue} secureTextEntry />
              {error ? <Text style={{ color: p.danger }}>{error}</Text> : null}
              <PrimaryButton label={t("vault.add")} loading={saving} disabled={!name.trim() || !value} onPress={() => void add()} />
            </View>
          ) : <Text style={[styles.hint, { color: p.muted, paddingHorizontal: metrics.padX }]}>{t("common.readOnly")}</Text>}
        />
      )}
    </Screen>
  );
}

export default function BrainsScreen() {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const { brains, namespace, select, loading, error, refresh } = useBrains();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [vault, setVault] = useState<Brain | null>(null);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function create() {
    if (!token) return;
    setSaving(true); setFormError("");
    try {
      const ns = name.trim().toLowerCase();
      await zekraApi.createBrain(token, { namespace: ns, displayName: displayName.trim() || undefined, description: description.trim() || undefined });
      await queryClient.invalidateQueries({ queryKey: ["brains"] });
      await select(ns);
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
          <Text style={[styles.stats, { color: p.muted }]}>{item.memories.toLocaleString()} {t("brains.memories")}</Text>
        </View>
        <Pressable onPress={() => setVault(item)} hitSlop={10} style={[styles.vaultBtn, { borderColor: p.line, backgroundColor: p.soft }]}>
          <KeyRound color={p.gold} size={17} />
        </Pressable>
      </Pressable>
    );
  }

  return (
    <Screen>
      <Header
        title={t("brains.title")}
        eyebrow={t("app.name")}
        actions={<Pressable onPress={() => setOpen(true)} style={[styles.iconButton, { backgroundColor: p.action }]}><Plus color={p.onAction} size={22} /></Pressable>}
      />
      {loading ? <StatePanel loading title={t("brains.loading")} /> : error ? <StatePanel title={t("brains.failed")} body={error.message} /> : (
        <FlatList
          data={brains}
          keyExtractor={(item) => item.namespace}
          renderItem={renderBrain}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={p.action} />}
          ListEmptyComponent={<StatePanel title={t("brains.empty")} body={t("brains.emptyBody")} />}
        />
      )}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <Screen>
          <Header title={t("brains.create")} eyebrow={t("brains.title")} actions={<Pressable onPress={() => setOpen(false)}><X color={p.ink} size={25} /></Pressable>} />
          <View style={styles.form}>
            <Field label={t("brains.namespace")} value={name} onChangeText={setName} autoCapitalize="none" placeholder="product-research" />
            <Text style={[styles.hint, { color: p.muted }]}>a–z, 0–9, dots, dashes, underscores.</Text>
            <Field label={t("brains.displayName")} value={displayName} onChangeText={setDisplayName} placeholder="Product research" />
            <Field label="Description" value={description} onChangeText={setDescription} multiline />
            {formError ? <Text style={{ color: p.danger }}>{formError}</Text> : null}
            <PrimaryButton label={t("brains.create")} loading={saving} disabled={!/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(name)} onPress={() => void create()} />
          </View>
        </Screen>
      </Modal>

      <Modal visible={!!vault} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVault(null)}>
        {vault ? <VaultSheet brain={vault} onClose={() => setVault(null)} /> : null}
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: metrics.padX, gap: 10, paddingBottom: 30 },
  card: { borderWidth: 1, borderRadius: 0, padding: 14, flexDirection: "row", gap: 13, alignItems: "flex-start" },
  mark: { width: 44, height: 44, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 17, fontWeight: "800" },
  namespace: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4 },
  description: { fontSize: 14, lineHeight: 19 },
  stats: { fontSize: 11, marginTop: 3 },
  vaultBtn: { width: 34, height: 34, borderWidth: 1, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  iconButton: { width: 42, height: 42, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  form: { padding: 18, gap: 14 },
  hint: { fontSize: 12, marginTop: -8 },
  vaultList: { padding: metrics.padX, gap: 10, paddingBottom: 40 },
  secretRow: { borderWidth: 1, borderRadius: 0, padding: 13, flexDirection: "row", alignItems: "center", gap: metrics.gap },
  vaultForm: { gap: metrics.gap, marginTop: metrics.gap },
});
