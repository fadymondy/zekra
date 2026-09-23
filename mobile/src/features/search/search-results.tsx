import { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";

import { AwaitNote, Bar, ErrorLine, TextButton } from "@/components/kit";
import { AppText, MicroLabel, Row } from "@/components/ui";
import { brainName, ltr } from "@/features/brains/brains-core";
import type { Recalled } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useBrains } from "@/providers/brains";
import { fonts, usePalette } from "@/theme";

import { groupByBrain, noteIdOf } from "./search-core";
import { SearchHit } from "./search-hit";
import type { useSemanticSearch } from "./use-search";

type SearchState = ReturnType<typeof useSemanticSearch>;

/**
 * The answer to a query, in house rows: a skeleton while the first answer is
 * on its way, an error row with retry, an empty row, or the hits grouped into
 * one row per brain (micro-label "BRAIN · n", best brain first). Shared by the
 * native (iOS 26+) and the classic search screens.
 */
export function SearchResults({ search, onOpenNote }: { search: SearchState; onOpenNote: (noteId: string, hit: Recalled) => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const { brains } = useBrains();
  const groups = useMemo(() => groupByBrain(search.results), [search.results]);

  if (search.loading) {
    return (
      <Row>
        <AppText variant="micro">{t("search.searching")}</AppText>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 9, paddingVertical: 10 }}>
            <Bar width="34%" height={10} />
            <Bar width="92%" height={12} />
            <Bar width="70%" height={12} />
          </View>
        ))}
      </Row>
    );
  }
  if (search.error && !search.results.length) {
    const offline = search.error.status === 0;
    return (
      <Row>
        <ErrorLine text={offline ? t("kit.offline") : search.error.message || t("search.failed")} />
        <TextButton label={t("kit.retry")} onPress={() => void search.refetch()} />
      </Row>
    );
  }
  if (search.answered && !search.results.length) {
    return (
      <Row>
        <AwaitNote text={t("search.empty")} />
        <AppText style={{ fontFamily: fonts.light, fontSize: 14, lineHeight: 24, color: p.muted }}>{t("search.emptyBody")}</AppText>
      </Row>
    );
  }
  if (!search.results.length) return null;

  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 28 }} accessibilityLiveRegion="polite">
        <AppText variant="micro" style={{ flex: 1 }}>{t("nav.resultCount", { count: search.results.length })}</AppText>
        {search.fetching ? <ActivityIndicator size="small" color={p.gold} accessibilityLabel={t("nav.updating")} /> : null}
      </View>
      {groups.map((group) => {
        const brain = brains.find((b) => b.namespace === group.namespace);
        const title = group.namespace ? (brain ? brainName(brain) : ltr(group.namespace)) : t("search.resultsLabel");
        return (
          <Row key={group.namespace || "_"} style={{ paddingVertical: 12, gap: 4 }}>
            <MicroLabel>{`${title} · ${group.hits.length}`}</MicroLabel>
            <View>
              {group.hits.map((item, i) => {
                const noteId = noteIdOf(item.sourceRef);
                return (
                  <SearchHit
                    key={item.id}
                    item={item}
                    last={i === group.hits.length - 1}
                    onOpen={noteId ? () => onOpenNote(noteId, item) : undefined}
                  />
                );
              })}
            </View>
          </Row>
        );
      })}
    </>
  );
}
