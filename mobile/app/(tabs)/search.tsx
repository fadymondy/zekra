import { useMutation } from "@tanstack/react-query";
import { router } from "expo-router";
import { CornerDownLeft, Search as SearchIcon } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";

import { AppText, Header, Row, Screen, StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { zekraApi, type Recalled } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, type as typeScale, usePalette } from "@/theme";

// Semantic search is the point of the product: this asks the hybrid
// vector + BM25 recall engine (POST /api/brain/search), not a text filter.
export default function SearchScreen() {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const { token } = useAuth();
  const { namespace, current } = useBrains();
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"all" | "brain">("all");
  const [submitted, setSubmitted] = useState("");

  const search = useMutation({
    mutationFn: (query: string) =>
      zekraApi.search(token!, query, scope === "brain" && namespace ? [namespace] : undefined, 30),
  });

  function run() {
    const query = input.trim();
    if (!query) return;
    setSubmitted(query);
    search.mutate(query);
  }

  const results = search.data?.results ?? [];

  const row = ({ item }: { item: Recalled }) => {
    const noteId = item.sourceRef?.startsWith("note:") ? item.sourceRef.slice(5).split("#")[0] : undefined;
    return (
      <Row onPress={noteId ? () => router.push({ pathname: "/note/[id]", params: { id: noteId } }) : undefined}>
        <View style={styles.top}>
          <View style={[styles.dot, { backgroundColor: p.action }]} />
          <AppText variant="micro" numberOfLines={1} style={{ flex: 1 }}>
            {(item.namespace || current?.displayName || namespace || "").toUpperCase()}
          </AppText>
          <AppText variant="mono" color={p.gold}>{Math.round(item.score * 100) / 100}</AppText>
        </View>
        <AppText variant="body" numberOfLines={4}>{item.content}</AppText>
        <AppText variant="micro" numberOfLines={1}>{item.memoryType} / {item.sourceKind}</AppText>
      </Row>
    );
  };

  let body;
  if (search.isPending) body = <StatePanel loading title={t("search.searching")} />;
  else if (search.error) body = <StatePanel title={t("search.failed")} body={search.error.message} />;
  else if (!submitted) body = <StatePanel title={t("search.start")} body={t("search.startBody")} />;
  else if (!results.length) body = <StatePanel title={t("search.empty")} body={t("search.emptyBody")} />;
  else {
    body = (
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={row}
        ItemSeparatorComponent={() => <View style={{ height: metrics.gap }} />}
        contentContainerStyle={{ paddingVertical: metrics.gap }}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <Screen
      header={
        <Header
          eyebrow={current?.displayName || namespace || t("search.allBrains")}
          title={t("search.title")}
          count={results.length || undefined}
        />
      }
    >
      <View style={[styles.searchRow, { borderColor: p.line, backgroundColor: p.card }]}>
        <SearchIcon color={p.muted} size={18} strokeWidth={1.6} />
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={run}
          placeholder={t("search.placeholder")}
          placeholderTextColor={p.muted}
          returnKeyType="search"
          style={[styles.input, { color: p.ink, fontFamily: fonts.regular, textAlign: isRtl ? "right" : "left" }]}
        />
        <Pressable onPress={run} disabled={!input.trim()} style={[styles.go, { backgroundColor: p.action, opacity: input.trim() ? 1 : 0.4 }]}>
          <CornerDownLeft color={p.onAction} size={17} strokeWidth={1.8} />
        </Pressable>
      </View>

      <View style={styles.scopeRow}>
        {(["all", "brain"] as const).map((option) => {
          if (option === "brain" && !namespace) return null;
          const active = scope === option;
          return (
            <Pressable
              key={option}
              onPress={() => setScope(option)}
              style={[styles.scope, { borderColor: active ? p.action : p.line, backgroundColor: active ? p.action : "transparent" }]}
            >
              <AppText variant="micro" color={active ? p.onAction : p.muted}>
                {(option === "all" ? t("search.allBrains") : current?.displayName || namespace || "").toUpperCase()}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: { marginHorizontal: metrics.padX, marginTop: metrics.gap, minHeight: metrics.input, borderWidth: 1, borderRadius: metrics.radius.control, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: typeScale.body, height: "100%" },
  go: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: metrics.radius.chip },
  scopeRow: { flexDirection: "row", gap: 8, marginHorizontal: metrics.padX, marginTop: 10, marginBottom: 4 },
  scope: { borderWidth: 1, borderRadius: metrics.radius.chip, paddingHorizontal: 11, paddingVertical: 6 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7 },
});
