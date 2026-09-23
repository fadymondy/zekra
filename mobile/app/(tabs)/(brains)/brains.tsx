import { router } from "expo-router";
import { Plus, Search, X } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { AwaitNote, ErrorLine, FilterStrip, TextButton } from "@/components/kit";
import { AppText, Field, Header, IconButton, PrimaryButton, Row, Screen } from "@/components/ui";
import { NotificationBell } from "@/features/notify";
import { BrainActionsSheet } from "@/features/brains/brain-actions-sheet";
import { BrainCard, BrainCardSkeleton } from "@/features/brains/brain-card";
import { useBrainList, useBrainStats } from "@/features/brains/brain-data";
import { filterSort, type BrainListItem, type Sort } from "@/features/brains/brains-core";
import { NewBrainSheet } from "@/features/brains/new-brain-sheet";
import { StatsStrip } from "@/features/brains/stats-strip";
import { ZekraMark } from "@/features/splash/zekra-mark";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

// Brains is home (MH-365): the web console's /brains page in the mobile house
// style — the fleet stats strip, a client-side search, a sort strip, and one
// full-bleed card per brain. Tap opens the brain; long-press (or ⋯) opens its
// actions. Notes, presentations and the vault live inside a brain.
export default function BrainsScreen() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const list = useBrainList();
  const stats = useBrainStats();
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<BrainListItem | null>(null);
  const [pulling, setPulling] = useState(false);

  const shown = useMemo(() => filterSort(list.brains, term, sort, locale), [list.brains, term, sort, locale]);

  const onOpen = useCallback((ns: string) => router.push({ pathname: "/brain/[ns]", params: { ns } }), []);
  const onMenu = useCallback((b: BrainListItem) => setMenu(b), []);
  const onRefresh = async () => {
    setPulling(true);
    try {
      await Promise.all([list.refetch(), stats.refetch()]);
    } finally {
      setPulling(false);
    }
  };

  const newButton = (
    <PrimaryButton label={t("brains.new.button")} icon={<Plus size={18} color={p.onAction} strokeWidth={1.8} />} onPress={() => setCreating(true)} />
  );

  const top = (
    <View style={{ gap: metrics.gap, paddingTop: metrics.gap }}>
      <StatsStrip stats={stats.data} fallbackBrains={list.loading ? undefined : list.brains.length} loading={list.loading && !stats.data} />
      <Row style={{ paddingBottom: 4 }}>
        <Field
          value={term}
          onChangeText={setTerm}
          placeholder={t("brains.searchPlaceholder")}
          accessibilityLabel={t("brains.searchPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          icon={<Search size={17} color={p.muted} strokeWidth={1.6} />}
          trailing={
            term ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t("brains.clearSearch")} hitSlop={10} onPress={() => setTerm("")}>
                <X size={17} color={p.muted} strokeWidth={1.6} />
              </Pressable>
            ) : undefined
          }
        />
        <FilterStrip<Sort>
          inset={false}
          value={sort}
          onChange={setSort}
          options={[
            { value: "recent", label: t("brains.sort.recent") },
            { value: "name", label: t("brains.sort.name") },
            { value: "memories", label: t("brains.sort.memories") },
          ]}
        />
      </Row>
      {list.error && !list.brains.length ? (
        <Row>
          <ErrorLine text={(list.error as { status?: number }).status === 0 ? t("brains.error.network") : list.error.message || t("brains.failed")} />
          <TextButton label={t("kit.retry")} onPress={() => void onRefresh()} />
        </Row>
      ) : list.loading ? (
        <>
          <BrainCardSkeleton />
          <BrainCardSkeleton />
          <BrainCardSkeleton />
        </>
      ) : list.brains.length === 0 ? (
        <Row style={{ alignItems: "center", paddingVertical: 28, gap: 14 }}>
          <View style={{ width: 64, height: 64, borderRadius: 14, borderWidth: 1, borderColor: p.line, backgroundColor: p.card, alignItems: "center", justifyContent: "center" }}>
            <ZekraMark size={40} />
          </View>
          <AppText style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 28, color: p.ink, textAlign: "center" }}>{t("brains.emptyTitle")}</AppText>
          <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: 26, color: p.muted, textAlign: "center" }}>{t("brains.emptyLead")}</AppText>
          <View style={{ alignSelf: "stretch" }}>{newButton}</View>
        </Row>
      ) : shown.length === 0 ? (
        <Row>
          <AwaitNote text={t("brains.emptySearch")} />
          <AppText style={{ fontFamily: fonts.light, fontSize: 14, lineHeight: 24, color: p.muted }}>{t("brains.emptySearchBody")}</AppText>
        </Row>
      ) : null}
    </View>
  );

  return (
    <Screen
      header={
        <Header
          title={t("brains.title")}
          count={list.loading ? undefined : list.brains.length}
          actions={
            <>
              <NotificationBell />
              <IconButton label={t("brains.new.button")} tone="action" onPress={() => setCreating(true)}>
                <Plus size={20} color={p.onAction} strokeWidth={1.8} />
              </IconButton>
            </>
          }
        />
      }
    >
      <FlatList showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        data={list.loading ? [] : shown}
        keyExtractor={(b) => b.namespace}
        renderItem={({ item }) => <BrainCard brain={item} onOpen={onOpen} onMenu={onMenu} />}
        ListHeaderComponent={top}
        ListHeaderComponentStyle={{ marginBottom: shown.length && !list.loading ? metrics.gap : 0 }}
        ItemSeparatorComponent={Gap}
        contentContainerStyle={{ paddingBottom: metrics.gap * 2 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={6}
        windowSize={7}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onRefresh()} tintColor={p.gold} colors={[p.gold]} progressBackgroundColor={p.card} />}
      />

      <NewBrainSheet open={creating} onClose={() => setCreating(false)} onCreated={onOpen} />
      <BrainActionsSheet brain={menu} onClose={() => setMenu(null)} />
    </Screen>
  );
}

function Gap() {
  return <View style={{ height: metrics.gap }} />;
}
