import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Check, ListFilter, Plus, Search } from "lucide-react-native";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";

import { BottomSheet, FilterStrip, QueryStatus, SheetItem, useQueryRefresh } from "@/components/kit";
import { AppText, PrimaryButton, Row } from "@/components/ui";
import type { Brain } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

import { presentationsApi } from "./api";
import { CreateFromBrainSheet } from "./create-sheet";
import { useDebounced, useFormat } from "./parts";
import { PresentationRow } from "./presentation-row";
import { KINDS, STATUSES } from "./presentations-core";
import type { PKind, PStatus } from "./types";

type KindFilter = PKind | "all";
type StatusFilter = PStatus | "all";

/*
The "Presentations" tab of a brain (MH-369): its decks, reports and pages,
searchable by title/customer and filtered by kind (strip) and status (sheet),
with "Create from brain" for editors. Rendered by app/brain/[ns].tsx below
its header, filling the rest of the screen on the hatch ground.
*/
export function BrainPresentations({ brain }: { brain: Brain }) {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const f = useFormat();
  const { token } = useAuth();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [statusOpen, setStatusOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const q = useDebounced(search.trim(), 300);

  const list = useQuery({
    queryKey: ["presentations", token, brain.namespace, q, kind, status],
    queryFn: () => presentationsApi.list(token!, { namespace: brain.namespace, q, kind, status, limit: 200 }),
    enabled: !!token,
    placeholderData: (prev) => prev,
  });
  const refresh = useQueryRefresh(list);
  const items = list.data?.items ?? [];
  const filtered = !!q || kind !== "all" || status !== "all";

  const header = (
    <View>
      <View style={styles.searchRow}>
        <View style={[styles.search, { borderColor: p.line, backgroundColor: p.card }]}>
          <Search size={16} color={p.muted} strokeWidth={1.6} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("presentations.search")}
            placeholderTextColor={p.muted}
            returnKeyType="search"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[styles.searchInput, { color: p.ink, fontFamily: fonts.regular, textAlign: isRtl ? "right" : "left" }]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("presentations.filter.status")}
          onPress={() => setStatusOpen(true)}
          style={({ pressed }) => [
            styles.statusBtn,
            {
              borderColor: status !== "all" ? p.gold : p.line,
              backgroundColor: status !== "all" ? `${p.gold}1A` : pressed ? p.soft : p.card,
            },
          ]}
        >
          <ListFilter size={16} color={status !== "all" ? p.gold : p.muted} strokeWidth={1.6} />
          <AppText style={{ fontFamily: fonts.regular, fontSize: 13, color: status !== "all" ? p.gold : p.muted }}>
            {status === "all" ? t("presentations.status.any") : f.status(status)}
          </AppText>
        </Pressable>
      </View>
      <FilterStrip<KindFilter>
        value={kind}
        onChange={setKind}
        options={[{ value: "all", label: t("presentations.kind.all") }, ...KINDS.map((k) => ({ value: k, label: f.kind(k) }))]}
      />
      {brain.canWrite ? (
        <View style={{ marginBottom: metrics.gap }}>
          <Row>
            <PrimaryButton
              label={t("presentations.create")}
              icon={<Plus size={17} color={p.onAction} strokeWidth={1.8} />}
              onPress={() => setCreateOpen(true)}
            />
          </Row>
        </View>
      ) : null}
      <QueryStatus
        q={list}
        empty={!list.isPending && !list.error && items.length === 0}
        emptyText={filtered ? t("presentations.emptyFiltered") : t("presentations.empty")}
      />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list.error ? [] : items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <PresentationRow item={item} onPress={() => router.push(`/presentation/${encodeURIComponent(item.id)}`)} />}
        ItemSeparatorComponent={() => <View style={{ height: metrics.gap }} />}
        contentContainerStyle={{ paddingBottom: metrics.gap * 2 }}
        refreshControl={refresh}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      <BottomSheet open={statusOpen} onClose={() => setStatusOpen(false)} title={t("presentations.filter.status")}>
        {(["all", ...STATUSES] as StatusFilter[]).map((s) => (
          <SheetItem
            key={s}
            label={s === "all" ? t("presentations.status.any") : f.status(s)}
            tone={s === status ? "gold" : undefined}
            trailing={s === status ? <Check size={18} color={p.gold} strokeWidth={1.8} /> : null}
            onPress={() => { setStatus(s); setStatusOpen(false); }}
          />
        ))}
      </BottomSheet>

      {brain.canWrite ? <CreateFromBrainSheet brain={brain} open={createOpen} onClose={() => setCreateOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: "row", gap: 8, paddingHorizontal: metrics.padX, paddingTop: 12 },
  search: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: metrics.radius.control, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 11 },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  statusBtn: { minHeight: 40, borderWidth: 1, borderRadius: metrics.radius.chip, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11 },
});
