import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { FilePlus2, Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from "react-native";

import { BrainPicker } from "@/components/brain-picker";
import { NoteRow, type NoteAction } from "@/components/note-row";
import { Header, IconButton, Screen, StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { zekraApi, type Note } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, type as typeScale, usePalette } from "@/theme";

export default function NotesScreen() {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const { token } = useAuth();
  const { namespace, current } = useBrains();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);

  const notes = useInfiniteQuery({
    queryKey: ["notes", token, namespace, query],
    queryFn: ({ pageParam }) => zekraApi.notes(token!, namespace, { q: query, cursor: pageParam, limit: 50 }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: !!token && !!namespace,
  });
  const all = useMemo(() => notes.data?.pages.flatMap((page) => page.notes) ?? [], [notes.data]);
  const act = useMutation({
    mutationFn: async ({ note, action }: { note: Note; action: NoteAction }) => {
      if (action === "delete") return zekraApi.deleteNote(token!, note);
      if (action === "pin") return zekraApi.updateNote(token!, note, { pinned: !note.pinned });
      return zekraApi.updateNote(token!, note, { archived: !note.archived });
    },
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["notes"] }); },
  });

  const create = useMutation({
    mutationFn: () => zekraApi.createNote(token!, namespace),
    onSuccess: (note) => {
      client.setQueryData(["note", token, note.id], note);
      void client.invalidateQueries({ queryKey: ["notes"] });
      router.push({ pathname: "/note/[id]", params: { id: note.id } });
    },
  });

  const row = ({ item }: { item: Note }) => (
    <NoteRow
      note={item}
      onOpen={() => router.push({ pathname: "/note/[id]", params: { id: item.id } })}
      onAction={(action) => act.mutate({ note: item, action })}
    />
  );

  const header = (
    <Header
      eyebrow={current?.displayName || namespace || t("notes.chooseBrain")}
      title={t("notes.title")}
      count={all.length || undefined}
      actions={current?.canWrite ? (
        <IconButton label={t("notes.title")} disabled={create.isPending} onPress={() => create.mutate()}>
          <FilePlus2 color={p.action} size={20} strokeWidth={1.7} />
        </IconButton>
      ) : undefined}
    />
  );

  let body;
  if (!namespace) body = <StatePanel title={t("notes.chooseBrain")} body={t("notes.chooseBrainBody")} />;
  else if (notes.isLoading) body = <StatePanel loading title={t("common.loading")} />;
  else if (notes.error) body = <StatePanel title={t("notes.noMatches")} body={notes.error.message} />;
  else {
    body = (
      <FlatList
        data={all}
        keyExtractor={(item) => item.id}
        renderItem={row}
        ItemSeparatorComponent={() => <View style={{ height: metrics.gap }} />}
        contentContainerStyle={all.length ? { paddingVertical: metrics.gap } : { flex: 1 }}
        refreshControl={<RefreshControl refreshing={notes.isRefetching} onRefresh={() => void notes.refetch()} tintColor={p.action} />}
        onEndReached={() => { if (notes.hasNextPage && !notes.isFetchingNextPage) void notes.fetchNextPage(); }}
        onEndReachedThreshold={0.35}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<StatePanel title={query ? t("notes.noMatches") : t("notes.empty")} body={query ? t("notes.noMatchesBody") : t("notes.emptyBody")} />}
        ListFooterComponent={notes.isFetchingNextPage ? <StatePanel loading title={t("notes.loadingMore")} /> : null}
      />
    );
  }

  return (
    <Screen header={header}>
      <BrainPicker />
      <View style={[styles.search, { borderBottomColor: p.line, backgroundColor: p.bg }]}>
        <Search color={p.muted} size={18} strokeWidth={1.6} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("notes.searchPlaceholder")}
          placeholderTextColor={p.muted}
          style={[styles.searchInput, { color: p.ink, fontFamily: fonts.regular, textAlign: isRtl ? "right" : "left" }]}
          returnKeyType="search"
        />
      </View>
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { height: 50, paddingHorizontal: metrics.padX, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1 },
  searchInput: { flex: 1, fontSize: typeScale.body, height: "100%" },
});
