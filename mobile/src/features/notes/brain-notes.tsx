import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { ArrowUpDown, Check, Plus, Search, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FlatList, Pressable, StyleSheet, View, type ListRenderItem } from "react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AwaitNote, BottomSheet, ErrorLine, FilterStrip, QueryStatus, SheetItem, Spinner, TextButton, useQueryRefresh } from "@/components/kit";
import { Field, PrimaryButton, Row } from "@/components/ui";
import type { Brain, Note } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

import { noteKeys, notesApi } from "./api";
import { NoteRow, type OpenRowRegistry } from "./note-row";
import { NoteSheet } from "./note-sheet";
import { visibleNotes, type NoteFilter, type NoteSort, type NoteView } from "./notes-core";
import { useNoteActions } from "./use-note-actions";

const SEARCH_DEBOUNCE_MS = 300;
/** The Archived view filters client-side (see listParams); keep paging until
 *  it has at least this many rows or the brain runs out. */
const ARCHIVED_FILL = 12;

const keyOf = (note: Note) => note.id;
const Gap = () => <View style={{ height: metrics.gap }} />;

function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

/**
 * The Notes tab of a brain (app/brain/[ns].tsx): filter field, All / Pinned /
 * Archived, sort, and a cursor-paged list with pull-to-refresh.
 *
 * "New note" (MH-362) opens the editor on id "new" with the brain; the editor
 * creates the note on its first save that has content. Nothing is created
 * here, so an empty note can never be posted (the server rejects one with no
 * title and no body).
 */
export function BrainNotes({ brain }: { brain: Brain }) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const insets = useSafeAreaInsets();
  const ns = brain.namespace;

  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [sort, setSort] = useState<NoteSort>("updated");
  const [sortOpen, setSortOpen] = useState(false);
  const view = useMemo<NoteView>(() => ({ filter, sort, q }), [filter, sort, q]);

  const list = useInfiniteQuery({
    queryKey: noteKeys.list(ns, view),
    queryFn: ({ pageParam, signal }) => notesApi.list(token!, ns, view, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: !!token,
    // Typing in the filter keeps the current rows up until the new ones land.
    placeholderData: keepPreviousData,
  });
  const notes = useMemo(() => visibleNotes(list.data?.pages ?? [], filter), [list.data, filter]);
  const refresh = useQueryRefresh(list);
  const actions = useNoteActions(ns);

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, isFetching, fetchNextPage } = list;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage]);

  // A sparse Archived view would otherwise sit short of the screen with no
  // scroll to trigger the next page.
  useEffect(() => {
    if (filter === "archived" && notes.length < ARCHIVED_FILL && !isFetching) loadMore();
  }, [filter, notes.length, isFetching, loadMore]);

  // One open row at a time; scrolling closes it.
  const openRow = useRef<SwipeableMethods | null>(null);
  const registry = useMemo<OpenRowRegistry>(() => ({
    claim(row) {
      if (openRow.current && openRow.current !== row) openRow.current.close();
      openRow.current = row;
    },
    release(row) {
      if (openRow.current === row) openRow.current = null;
    },
    closeAll() {
      openRow.current?.close();
      openRow.current = null;
    },
  }), []);

  // The long-press sheet. The note snapshot outlives `open` so the sheet can
  // animate out with its content; while open it follows the cached copy, so an
  // optimistic pin or appearance change shows in the sheet at once.
  const [menu, setMenu] = useState<Note | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuNote = (menu && notes.find((n) => n.id === menu.id)) ?? menu;

  const create = useCallback(() => {
    router.push({ pathname: "/note/[id]", params: { id: "new", ns } });
  }, [ns]);
  const onOpen = useCallback((note: Note) => {
    router.push({ pathname: "/note/[id]", params: { id: note.id } });
  }, []);
  const onMenu = useCallback((note: Note) => {
    registry.closeAll();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenu(note);
    setMenuOpen(true);
  }, [registry]);
  const onPin = useCallback((note: Note) => void actions.togglePin(note), [actions]);
  const onArchive = useCallback((note: Note) => actions.askArchive(note), [actions]);
  const onDelete = useCallback((note: Note) => actions.askDelete(note), [actions]);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const renderItem = useCallback<ListRenderItem<Note>>(
    ({ item }) => (
      <NoteRow
        note={item}
        canWrite={brain.canWrite}
        registry={registry}
        onOpen={onOpen}
        onMenu={onMenu}
        onPin={onPin}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    ),
    [brain.canWrite, registry, onOpen, onMenu, onPin, onArchive, onDelete],
  );

  let empty: ReactElement | null = null;
  if (list.isPending || (list.error && !list.data)) {
    empty = <QueryStatus q={list} />;
  } else if (!hasNextPage) {
    const text = q
      ? t("notes.x.noMatches", { q })
      : filter === "pinned"
        ? t("notes.x.emptyPinned")
        : filter === "archived"
          ? t("notes.x.emptyArchived")
          : t("notes.x.empty");
    empty = (
      <Row>
        <AwaitNote text={text} />
        {brain.canWrite && filter === "all" && !q ? (
          <PrimaryButton label={t("notes.x.new")} icon={<Plus size={17} color={p.onAction} strokeWidth={1.9} />} onPress={create} />
        ) : null}
      </Row>
    );
  }

  // A failed refresh while rows are showing: say so above them, keep the rows.
  const refetchFailed = list.isRefetchError && notes.length > 0;
  const searching = search.trim() !== q || (list.isPlaceholderData && isFetching);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.toolbar}>
        <View style={{ flex: 1 }}>
          <Field
            value={search}
            onChangeText={setSearch}
            placeholder={t("notes.x.search")}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            accessibilityLabel={t("notes.x.search")}
            style={[styles.searchInput, { paddingEnd: search || searching ? 64 : 13 }]}
          />
          <View pointerEvents="none" style={[styles.searchIcon, { start: 13 }]}>
            <Search size={17} color={p.muted} strokeWidth={1.6} />
          </View>
          {searching ? (
            <View pointerEvents="none" style={[styles.searchEnd, { end: search ? 40 : 8 }]}>
              <Spinner />
            </View>
          ) : null}
          {search ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("notes.x.clearSearch")}
              onPress={() => setSearch("")}
              hitSlop={6}
              style={[styles.searchEnd, { end: 6 }]}
            >
              <X size={17} color={p.muted} strokeWidth={1.7} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("notes.x.sort")}
          onPress={() => setSortOpen(true)}
          style={({ pressed }) => [styles.square, { borderColor: sort === "updated" ? p.line : p.gold, backgroundColor: pressed ? p.soft : p.card }]}
        >
          <ArrowUpDown size={18} color={sort === "updated" ? p.muted : p.gold} strokeWidth={1.6} />
        </Pressable>
        {brain.canWrite ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("notes.x.new")}
            onPress={create}
            style={({ pressed }) => [styles.square, { borderColor: p.action, backgroundColor: p.action, opacity: pressed ? 0.85 : 1 }]}
          >
            <Plus size={20} color={p.onAction} strokeWidth={1.9} />
          </Pressable>
        ) : null}
      </View>

      <FilterStrip<NoteFilter>
        value={filter}
        onChange={(next) => {
          registry.closeAll();
          setFilter(next);
        }}
        options={[
          { value: "all", label: t("notes.x.filter.all") },
          { value: "pinned", label: t("notes.x.filter.pinned") },
          { value: "archived", label: t("notes.x.filter.archived") },
        ]}
      />

      <FlatList
        data={notes}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={
          refetchFailed ? (
            <View style={{ marginBottom: metrics.gap }}>
              <Row>
                <ErrorLine text={list.error?.message || t("kit.error")} />
                <TextButton label={t("kit.retry")} onPress={() => void list.refetch()} />
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
                <ErrorLine text={t("notes.x.loadMoreFailed")} />
                <TextButton label={t("kit.retry")} onPress={() => void fetchNextPage()} />
              </Row>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: metrics.gap + insets.bottom }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={refresh}
        onScrollBeginDrag={registry.closeAll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={11}
      />

      <NoteSheet note={menuNote} brain={brain} open={menuOpen} onClose={closeMenu} onOpenNote={onOpen} actions={actions} />

      <BottomSheet open={sortOpen} onClose={() => setSortOpen(false)} title={t("notes.x.sort")}>
        {(["updated", "created", "title"] as const).map((option) => (
          <SheetItem
            key={option}
            label={t(option === "updated" ? "notes.x.sort.updated" : option === "created" ? "notes.x.sort.created" : "notes.x.sort.title")}
            tone={sort === option ? "gold" : undefined}
            trailing={sort === option ? <Check size={17} color={p.gold} strokeWidth={2} /> : null}
            onPress={() => {
              setSort(option);
              setSortOpen(false);
            }}
          />
        ))}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: metrics.padX, paddingTop: metrics.gap },
  searchInput: { minHeight: metrics.touch, height: metrics.touch, paddingStart: 38 },
  searchIcon: { position: "absolute", top: 0, bottom: 0, justifyContent: "center" },
  searchEnd: { position: "absolute", top: 0, bottom: 0, width: 32, alignItems: "center", justifyContent: "center" },
  square: { width: metrics.touch, height: metrics.touch, borderWidth: 1, borderRadius: metrics.radius.control, alignItems: "center", justifyContent: "center" },
  footer: { paddingVertical: metrics.gap, alignItems: "center" },
});
