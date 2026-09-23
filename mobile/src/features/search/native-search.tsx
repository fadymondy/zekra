import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";

import { useI18n } from "@/lib/i18n";
import { useBrains } from "@/providers/brains";
import { fonts, metrics, useTheme } from "@/theme";

import { useRecentSearches } from "./recent";
import { isLiveQuery, normalizeQuery, SEARCH_DEBOUNCE_MS } from "./search-core";
import { ScopeChip, SearchBrowse } from "./search-browse";
import { SearchResults } from "./search-results";
import { useDebounced, useSemanticSearch } from "./use-search";

// The iOS 26+ search screen (MH-360), modelled on Apple Health's search.
//
// Chrome is native: this screen is the root of the Search tab's native stack
// (app/(tabs)/search/_layout.tsx) and the tab is the system search tab
// (role="search", src/features/nav/native-tabs.tsx). Its
// `headerSearchBarOptions` becomes the stack's UISearchController, which
// iOS 26 hosts in the tab bar — the Liquid Glass field at the bottom that
// morphs out of the search button. Large title "Search" on an opaque bar in
// the app's ground colour.
//
// The body is the house design: hatch ground between the rails, full-bleed
// rows. Empty field → browse (recent searches + the brains, which double as
// the scope picker); typing → live results (debounced; submit asks at once),
// grouped by brain.

export function NativeSearchScreen() {
  const { palette: p } = useTheme();
  const { t, isRtl } = useI18n();
  const { brains } = useBrains();
  const { recent, add: remember, clear: clearRecent } = useRecentSearches();
  const bar = useRef<SearchBarCommands>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [scopeNs, setScopeNs] = useState<string | undefined>();
  // The last query asked explicitly (search key / a recent), so the debounce
  // catching up with the same text afterwards doesn't undo it.
  const submitted = useRef("");

  const debounced = useDebounced(text, SEARCH_DEBOUNCE_MS);
  useEffect(() => {
    const q = normalizeQuery(debounced);
    if (q === submitted.current) return;
    submitted.current = "";
    setQuery(isLiveQuery(q) ? q : "");
  }, [debounced]);

  const onChange = useCallback((next: string) => {
    setText(next);
    // Clearing the field returns to browse at once, without the debounce.
    if (!normalizeQuery(next)) {
      submitted.current = "";
      setQuery("");
    }
  }, []);

  const onSubmit = useCallback((raw: string) => {
    const q = normalizeQuery(raw);
    if (!q) return;
    submitted.current = q;
    setQuery(q);
    remember(q);
  }, [remember]);

  const onCancel = useCallback(() => {
    submitted.current = "";
    setText("");
    setQuery("");
  }, []);

  const runRecent = useCallback((q: string) => {
    bar.current?.setText(q);
    setText(q);
    onSubmit(q);
  }, [onSubmit]);

  // A brain row scopes the search to it (tap again to widen back to all).
  const pickBrain = useCallback((ns: string) => {
    setScopeNs((prev) => (prev === ns ? undefined : ns));
    bar.current?.focus();
  }, []);

  const scopeBrain = brains.find((b) => b.namespace === scopeNs);
  const search = useSemanticSearch(query, scopeBrain?.namespace, { live: true });

  const openNote = useCallback((noteId: string) => {
    if (query) remember(query);
    router.push({ pathname: "/note/[id]", params: { id: noteId } });
  }, [query, remember]);

  const options = useMemo(
    () => ({
      title: t("search.title"),
      headerShown: true,
      headerLargeTitleEnabled: true,
      headerTransparent: false,
      headerStyle: { backgroundColor: p.bg },
      headerLargeStyle: { backgroundColor: p.bg },
      headerShadowVisible: false,
      headerLargeTitleShadowVisible: false,
      headerTintColor: p.action,
      headerTitleStyle: { fontFamily: fonts.semibold, color: p.ink },
      headerLargeTitleStyle: { fontFamily: fonts.semibold, color: p.ink },
      contentStyle: { backgroundColor: p.bg },
      // No `placement`: the default (automatic) is what iOS 26 integrates into
      // the search tab's bottom field. The browse/results stay live and
      // tappable while typing, and the large title stays put.
      headerSearchBarOptions: {
        ref: bar,
        placeholder: t("search.placeholder"),
        tintColor: p.action,
        textColor: p.ink,
        autoCapitalize: "none" as const,
        hideNavigationBar: false,
        obscureBackground: false,
        onChangeText: (e: { nativeEvent: { text: string } }) => onChange(e.nativeEvent.text),
        onSearchButtonPress: (e: { nativeEvent: { text: string } }) => onSubmit(e.nativeEvent.text),
        onCancelButtonPress: onCancel,
      },
    }),
    [t, p, onChange, onSubmit, onCancel],
  );

  return (
    <>
      <Stack.Screen options={options} />
      {/* The scroll view itself is pinned LTR; only its content is RTL.
          React Native's iOS ScrollView implements RTL by mirroring the
          UIScrollView with scaleX(-1) (and un-mirroring its own content
          container). On iOS 26+ UIKit hosts part of the navigation header —
          the large title that scrolls with the content — inside that
          UIScrollView, so an RTL scroll view drew "البحث" glyph-mirrored.
          Pinned LTR there is no transform at all; the content container still
          lays out right-to-left for Arabic. */}
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: p.bg, direction: "ltr" }}
        contentContainerStyle={{ flexGrow: 1, direction: isRtl ? "rtl" : "ltr" }}
      >
        <View style={{ gap: metrics.gap, paddingTop: 8, paddingBottom: metrics.gap + 8 }}>
          {scopeBrain ? <ScopeChip brain={scopeBrain} onClear={() => setScopeNs(undefined)} /> : null}
          {query ? (
            <SearchResults search={search} onOpenNote={openNote} />
          ) : (
            <SearchBrowse
              brains={brains}
              scopeNs={scopeBrain?.namespace}
              onPickBrain={pickBrain}
              onOpenBrain={(ns) => router.push({ pathname: "/brain/[ns]", params: { ns } })}
              recent={recent}
              onRecent={runRecent}
              onClearRecent={clearRecent}
            />
          )}
        </View>
      </ScrollView>
    </>
  );
}
