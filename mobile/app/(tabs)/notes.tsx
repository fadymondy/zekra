import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { AlertTriangle, FilePlus2, Pin, Search, Sparkles } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";

import { BrainPicker } from "@/components/brain-picker";
import { Header, Screen, StatePanel } from "@/components/ui";
import { zekraApi, type Note } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { usePalette } from "@/theme";

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString();
}

export default function NotesScreen() {
  const p = usePalette();
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
  const create = useMutation({
    mutationFn: () => zekraApi.createNote(token!, namespace),
    onSuccess: (note) => {
      client.setQueryData(["note", token, note.id], note);
      void client.invalidateQueries({ queryKey: ["notes"] });
      router.push({ pathname: "/note/[id]", params: { id: note.id } });
    },
  });

  const row = ({ item }: { item: Note }) => {
    const snippet = (item.body || "").replace(/[#>*_`\[\]]/g, "").replace(/\s+/g, " ").trim();
    return (
      <Pressable onPress={() => router.push({ pathname: "/note/[id]", params: { id: item.id } })} style={({ pressed }) => [styles.note, { borderBottomColor: p.line, backgroundColor: pressed ? p.soft : p.bg }]}>
        <View style={styles.noteTop}>
          {item.pinned ? <Pin color={p.gold} fill={p.gold} size={14} /> : null}
          <Text numberOfLines={1} style={[styles.noteTitle, { color: p.ink }]}>{item.title || "Untitled"}</Text>
          {!item.indexed ? item.indexError ? <AlertTriangle color={p.danger} size={15} /> : <Sparkles color={p.gold} size={15} /> : null}
          <Text style={[styles.time, { color: p.muted }]}>{relativeTime(item.updatedAt)}</Text>
        </View>
        {snippet ? <Text numberOfLines={2} style={[styles.snippet, { color: p.body }]}>{snippet}</Text> : null}
        <View style={styles.meta}>
          <View style={[styles.dot, { backgroundColor: p.action }]} />
          <Text style={[styles.category, { color: p.muted }]}>{item.category || "note"}</Text>
          {item.tags.slice(0, 2).map((tag) => <Text key={tag} numberOfLines={1} style={[styles.tag, { color: p.body, backgroundColor: p.soft }]}>{tag}</Text>)}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen>
      <Header
        eyebrow={current?.displayName || namespace || "Select a brain"}
        title="Notes"
        action={current?.canWrite ? (
          <Pressable disabled={create.isPending} onPress={() => create.mutate()} style={[styles.add, { backgroundColor: p.action, opacity: create.isPending ? 0.5 : 1 }]}>
            <FilePlus2 color={p.onAction} size={21} />
          </Pressable>
        ) : undefined}
      />
      <BrainPicker />
      <View style={[styles.search, { borderBottomColor: p.line }]}>
        <Search color={p.muted} size={18} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search titles, text, and tags"
          placeholderTextColor={p.muted}
          style={[styles.searchInput, { color: p.ink }]}
          returnKeyType="search"
        />
      </View>
      {!namespace ? <StatePanel title="Choose a brain" body="Open Brains to select a knowledge space." /> : notes.isLoading ? (
        <StatePanel loading title="Loading notes" />
      ) : notes.error ? (
        <StatePanel title="Could not load notes" body={notes.error.message} />
      ) : (
        <FlatList
          data={all}
          keyExtractor={(item) => item.id}
          renderItem={row}
          refreshControl={<RefreshControl refreshing={notes.isRefetching} onRefresh={() => void notes.refetch()} tintColor={p.action} />}
          onEndReached={() => { if (notes.hasNextPage && !notes.isFetchingNextPage) void notes.fetchNextPage(); }}
          onEndReachedThreshold={0.35}
          contentContainerStyle={all.length ? undefined : { flex: 1 }}
          ListEmptyComponent={<StatePanel title={query ? "No matches" : "A quiet brain"} body={query ? "Try a different search." : "Create the first note and Zekra will index it into this brain."} />}
          ListFooterComponent={notes.isFetchingNextPage ? <StatePanel loading title="Loading more" /> : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { width: 42, height: 42, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  search: { height: 52, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, fontSize: 15, height: "100%" },
  note: { paddingHorizontal: 17, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 7 },
  noteTop: { flexDirection: "row", alignItems: "center", gap: 7 },
  noteTitle: { flex: 1, fontSize: 16, fontWeight: "700" },
  time: { fontSize: 11, fontWeight: "600" },
  snippet: { fontSize: 13, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7 },
  category: { fontSize: 11, fontWeight: "600" },
  tag: { fontSize: 10, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 0, maxWidth: 100 },
});
