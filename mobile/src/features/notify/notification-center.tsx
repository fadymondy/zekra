import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import { Bell, BellRing, BrainCircuit, Check, Download, Presentation, Trash2 } from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { FlatList, StyleSheet, View, type ListRenderItem } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheet, ErrorLine, ListItem, QueryStatus, SheetItem, Spinner, StackHeader, TextButton, Tile, toast, useQueryRefresh } from "@/components/kit";
import { AppText, MicroLabel, Row, Screen } from "@/components/ui";
import { formatAgo } from "@/features/brains/brains-core";
import { routeFromData } from "@/features/push/push-core";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette, type Palette } from "@/theme";

import { groupByDay, kindVisual, type AppNotification, type DaySection } from "./notify-core";
import { inboxUnavailable, useNotificationActions, useNotifications, useUnreadCount } from "./use-notifications";

/**
 * The notification center (MH-360; route app/notifications.tsx): the account's
 * inbox grouped by day, newest first. Tap opens what an item is about and marks
 * it read; long-press offers mark read / delete. Pull to refresh; pages load as
 * the list nears its end.
 */

const Gap = () => <View style={{ height: metrics.gap }} />;
const keyOf = (s: DaySection) => s.key;

function KindTile({ kind, p }: { kind: string; p: Palette }) {
  const v = kindVisual(kind);
  const icon = { size: 18, strokeWidth: 1.6 };
  switch (v) {
    case "brain":
      return <Tile tint={p.gold}><BrainCircuit {...icon} color={p.gold} /></Tile>;
    case "presentation":
      return <Tile tint={p.action}><Presentation {...icon} color={p.action} /></Tile>;
    case "download":
      return <Tile tint={p.action}><Download {...icon} color={p.action} /></Tile>;
    case "test":
      return <Tile tint={p.ok}><BellRing {...icon} color={p.ok} /></Tile>;
    default:
      return <Tile><Bell {...icon} color={p.muted} /></Tile>;
  }
}

/** The route an item may open, checked like a push payload (remote input). */
function itemRoute(n: AppNotification): string | null {
  return routeFromData({ ...n.data, route: n.route });
}

const NotificationRow = memo(function NotificationRow({ item, last, now, onOpen, onMenu }: {
  item: AppNotification;
  last: boolean;
  now: number;
  onOpen: (n: AppNotification) => void;
  onMenu: (n: AppNotification) => void;
}) {
  const p = usePalette();
  const { locale, isRtl } = useI18n();
  const unread = !item.readAt;
  const when = formatAgo(item.createdAt, locale, now);
  return (
    <ListItem
      alignTop
      last={last}
      leading={<KindTile kind={item.kind} p={p} />}
      trailing={
        <View style={styles.end}>
          {/* JetBrains Mono has no Arabic: Arabic times use Lusail. */}
          <AppText numberOfLines={1} style={[isRtl ? styles.whenAr : styles.when, { color: p.muted }]}>{when}</AppText>
          {unread ? <View style={[styles.dot, { backgroundColor: p.gold }]} /> : null}
        </View>
      }
      onPress={() => onOpen(item)}
      onLongPress={() => onMenu(item)}
    >
      <AppText numberOfLines={2} style={{ fontFamily: unread ? fonts.medium : fonts.regular, fontSize: 14.5, lineHeight: 21, color: unread ? p.ink : p.body }}>
        {item.title}
      </AppText>
      {item.body ? (
        <AppText numberOfLines={2} style={{ fontFamily: fonts.light, fontSize: 13, lineHeight: 19, color: p.body }}>{item.body}</AppText>
      ) : null}
    </ListItem>
  );
});

export function NotificationCenter() {
  const p = usePalette();
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const list = useNotifications();
  const { unread } = useUnreadCount();
  const actions = useNotificationActions();
  const refresh = useQueryRefresh(list);
  const [menu, setMenu] = useState<AppNotification | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // "Now" for relative times and day buckets; refreshed with the data.
  const now = useMemo(() => Date.now(), [list.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => groupByDay(list.items, new Date(now)), [list.items, now]);

  // The badge polls; when it disagrees with the list, the list refetches.
  const listUnread = list.data?.pages[0]?.unread;
  const { refetch, isFetching } = list;
  useEffect(() => {
    if (listUnread !== undefined && unread !== listUnread && !isFetching) void refetch();
  }, [unread, listUnread, isFetching, refetch]);

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = list;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage]);

  const { markRead, markAllRead, remove } = actions;
  const onOpen = useCallback((n: AppNotification) => {
    void markRead([n]);
    const route = itemRoute(n);
    if (route) router.push(route as Href);
  }, [markRead]);
  const onMenu = useCallback((n: AppNotification) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenu(n);
    setMenuOpen(true);
  }, []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const dayLabel = useCallback((s: DaySection) => {
    if (s.day === "today") return t("notify.today");
    if (s.day === "yesterday") return t("notify.yesterday");
    const sameYear = s.date.getFullYear() === new Date(now).getFullYear();
    return s.date.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  }, [locale, now, t]);

  const renderItem = useCallback<ListRenderItem<DaySection>>(({ item: s }) => (
    <Row style={{ gap: 0, paddingBottom: 0 }}>
      <MicroLabel>{dayLabel(s)}</MicroLabel>
      {s.items.map((n, i) => (
        <NotificationRow key={n.id} item={n} last={i === s.items.length - 1} now={now} onOpen={onOpen} onMenu={onMenu} />
      ))}
    </Row>
  ), [dayLabel, now, onMenu, onOpen]);

  let empty: ReactElement | null = null;
  if (list.error && !list.data && inboxUnavailable(list.error)) {
    empty = (
      <Row style={{ alignItems: "center", paddingVertical: 36 }}>
        <Tile size={52} radius={12}><Bell size={24} color={p.muted} strokeWidth={1.5} /></Tile>
        <AppText style={{ fontFamily: fonts.medium, fontSize: 16, color: p.ink, textAlign: "center" }}>{t("notify.unavailableTitle")}</AppText>
        <AppText style={{ fontFamily: fonts.light, fontSize: 13, lineHeight: 20, color: p.muted, textAlign: "center" }}>{t("notify.unavailableBody")}</AppText>
      </Row>
    );
  } else if (list.isPending || (list.error && !list.data)) {
    empty = <QueryStatus q={list} />;
  } else if (!hasNextPage) {
    empty = (
      <Row style={{ alignItems: "center", paddingVertical: 36 }}>
        <Tile size={52} radius={12} gold><Bell size={24} color={p.gold} strokeWidth={1.5} /></Tile>
        <AppText style={{ fontFamily: fonts.medium, fontSize: 16, color: p.ink, textAlign: "center" }}>{t("notify.emptyTitle")}</AppText>
        <AppText style={{ fontFamily: fonts.light, fontSize: 13, lineHeight: 20, color: p.muted, textAlign: "center" }}>{t("notify.emptyBody")}</AppText>
      </Row>
    );
  }

  const onMarkAll = useCallback(() => {
    markAllRead().catch(() => toast(t("notify.failed"), "danger"));
  }, [markAllRead, t]);

  const menuItem = menu;
  return (
    <Screen
      header={
        <StackHeader
          title={t("notify.title")}
          subtitle={unread > 0 ? t("notify.unreadCount", { count: unread > 99 ? "99+" : unread }) : undefined}
          trailing={unread > 0 ? <TextButton label={t("notify.markAllRead")} onPress={onMarkAll} /> : null}
        />
      }
    >
      <FlatList showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        data={sections}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ItemSeparatorComponent={Gap}
        ListHeaderComponentStyle={{ marginBottom: metrics.gap }}
        ListHeaderComponent={
          // A failed refresh while rows are showing: say so above them, keep the rows.
          list.isRefetchError && list.items.length > 0 ? (
            <View style={{ paddingTop: metrics.gap }}>
              <Row>
                <ErrorLine text={list.error?.message || t("kit.error")} />
                <TextButton label={t("kit.retry")} onPress={() => void refetch()} />
              </Row>
            </View>
          ) : null
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <Spinner />
            </View>
          ) : isFetchNextPageError ? (
            <View style={{ marginTop: metrics.gap }}>
              <Row>
                <ErrorLine text={t("notify.loadMoreFailed")} />
                <TextButton label={t("kit.retry")} onPress={() => void fetchNextPage()} />
              </Row>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingTop: metrics.gap, paddingBottom: metrics.gap + insets.bottom }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={refresh}
        initialNumToRender={6}
        windowSize={9}
      />

      <BottomSheet open={menuOpen} onClose={closeMenu} title={menuItem?.title} subtitle={menuItem ? formatAgo(menuItem.createdAt, locale, now) : undefined}>
        {menuItem && itemRoute(menuItem) ? (
          <SheetItem
            label={t("notify.open")}
            onPress={() => {
              closeMenu();
              onOpen(menuItem);
            }}
          />
        ) : null}
        {menuItem && !menuItem.readAt ? (
          <SheetItem
            icon={<Check size={18} color={p.ink} strokeWidth={1.7} />}
            label={t("notify.markRead")}
            onPress={() => {
              closeMenu();
              void markRead([menuItem]);
            }}
          />
        ) : null}
        <SheetItem
          icon={<Trash2 size={18} color={p.danger} strokeWidth={1.7} />}
          label={t("notify.delete")}
          tone="danger"
          onPress={() => {
            closeMenu();
            if (menuItem) remove(menuItem).then(() => toast(t("notify.deleted")), () => toast(t("notify.failed"), "danger"));
          }}
        />
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  end: { alignItems: "flex-end", gap: 8, paddingTop: 2 },
  when: { fontFamily: fonts.mono, fontSize: 10.5 },
  whenAr: { fontFamily: "Lusail-Regular", fontSize: 11.5 }, // Arabic-only style
  dot: { width: 8, height: 8, borderRadius: 4 },
  footer: { paddingVertical: 18, alignItems: "center" },
});
