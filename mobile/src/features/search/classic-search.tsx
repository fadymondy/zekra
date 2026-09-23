import { router } from "expo-router";
import { Search as SearchIcon, X } from "lucide-react-native";
import { useRef, useState } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";

import { FilterStrip, useChevrons } from "@/components/kit";
import { AppText, Header, IconButton, Row, Screen } from "@/components/ui";
import { brainName } from "@/features/brains/brains-core";
import { useI18n } from "@/lib/i18n";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, usePalette } from "@/theme";

import { useRecentSearches } from "./recent";
import { normalizeQuery } from "./search-core";
import { SearchBrowse } from "./search-browse";
import { SearchResults } from "./search-results";
import { useSemanticSearch } from "./use-search";

type Scope = "all" | "brain";

// Semantic search (the point of the product): the hybrid vector + BM25 recall
// engine (POST /api/brain/search), across every brain the caller can read or
// one brain. Big header, a focused query field, a scope strip; below it the
// browse rows (recent searches, the brains — tap one to scope to it) until a
// question is asked, then the hits grouped by brain (SCREENS.md 03-2).
//
// The house-style screen: Android and iOS before 26. iOS 26+ gets
// ./native-search.tsx (see app/(tabs)/search/index.tsx).
export function ClassicSearchScreen() {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const { ForwardArrow } = useChevrons();
  const { brains, current } = useBrains();
  const { recent, add: remember, clear: clearRecent } = useRecentSearches();
  const [input, setInput] = useState("");
  // The brain searched when scoped: one picked from the browse rows, else the
  // last brain opened.
  const [scopeNs, setScopeNs] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState("");
  const [focused, setFocused] = useState(false);
  const field = useRef<TextInput>(null);
  const scopeBrain = brains.find((b) => b.namespace === scopeNs);
  const offerBrain = scopeBrain ?? current;
  const scope: Scope = scopeBrain ? "brain" : "all";

  // Changing scope re-asks the same question (the scope is part of the key).
  const search = useSemanticSearch(submitted, scopeBrain?.namespace);

  function run(query = input) {
    const q = normalizeQuery(query);
    if (!q) return;
    Keyboard.dismiss();
    remember(q);
    if (q === submitted) void search.refetch();
    else setSubmitted(q);
  }

  const band = (
    <View style={[styles.band, { borderBottomColor: p.line, backgroundColor: p.bg }]}>
      <View style={styles.queryRow}>
        <View style={[styles.query, { borderColor: focused ? p.action : p.line, backgroundColor: p.card }]}>
          <SearchIcon size={19} color={focused ? p.action : p.muted} strokeWidth={1.6} />
          <TextInput
            ref={field}
            value={input}
            onChangeText={(v) => {
              setInput(v);
              // An emptied field goes back to the browse rows.
              if (!normalizeQuery(v)) setSubmitted("");
            }}
            onSubmitEditing={() => run()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={t("search.placeholder")}
            placeholderTextColor={p.muted}
            selectionColor={p.action}
            cursorColor={p.action}
            returnKeyType="search"
            accessibilityLabel={t("search.placeholder")}
            style={{ flex: 1, minHeight: 44, fontFamily: fonts.regular, fontSize: 16.5, color: p.ink, writingDirection: isRtl ? "rtl" : "ltr" }}
          />
          {input ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t("search.clear")} hitSlop={10} onPress={() => { setInput(""); setSubmitted(""); field.current?.focus(); }}>
              <X size={17} color={p.muted} strokeWidth={1.6} />
            </Pressable>
          ) : null}
        </View>
        <IconButton label={t("search.go")} tone="action" disabled={!input.trim()} onPress={() => run()}>
          <ForwardArrow size={20} color={p.onAction} strokeWidth={1.8} />
        </IconButton>
      </View>
      {/* Scope: every readable brain, or the last brain opened. */}
      <FilterStrip<Scope>
        inset={false}
        value={scope}
        onChange={(next) => setScopeNs(next === "brain" ? offerBrain?.namespace : undefined)}
        options={[
          { value: "all", label: t("search.allBrains") },
          ...(offerBrain ? [{ value: "brain" as const, label: `${t("search.thisBrain")} · ${brainName(offerBrain)}` }] : []),
        ]}
      />
    </View>
  );

  const count = submitted && search.results.length ? search.results.length : undefined;

  return (
    <Screen
      scroll
      header={
        <View>
          <Header title={t("search.title")} count={count} />
          {band}
        </View>
      }
    >
      <View style={{ gap: metrics.gap, paddingTop: metrics.gap }}>
        {submitted ? (
          <SearchResults
            search={search}
            onOpenNote={(id) => router.push({ pathname: "/note/[id]", params: { id } })}
          />
        ) : (
          <>
            <Row>
              <AppText style={{ fontFamily: fonts.semibold, fontSize: 17, lineHeight: 28, color: p.ink }}>{t("search.start")}</AppText>
              <AppText style={{ fontFamily: fonts.light, fontSize: 15, lineHeight: 26, color: p.muted }}>{t("search.startBody")}</AppText>
            </Row>
            <SearchBrowse
              brains={brains}
              scopeNs={scopeBrain?.namespace}
              onPickBrain={(ns) => {
                setScopeNs((prev) => (prev === ns ? undefined : ns));
                field.current?.focus();
              }}
              onOpenBrain={(ns) => router.push({ pathname: "/brain/[ns]", params: { ns } })}
              recent={recent}
              onRecent={(q) => {
                setInput(q);
                run(q);
              }}
              onClearRecent={clearRecent}
            />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  band: { paddingTop: 12, paddingHorizontal: metrics.padX, borderBottomWidth: 1 },
  queryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  query: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 10 },
});
