import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AwaitNote, FilterStrip, StackHeader } from "@/components/kit";
import { Row, Screen } from "@/components/ui";
import { BrainAvatar } from "@/features/brains/brain-avatar";
import { BrainNotes } from "@/features/notes/brain-notes";
import { BrainPresentations } from "@/features/presentations/brain-presentations";
import { BrainVault } from "@/features/vault/brain-vault";
import { useI18n } from "@/lib/i18n";
import { useBrains } from "@/providers/brains";

type Tab = "notes" | "presentations" | "vault";

// A brain, as on the web console (/b/{ns}): its notes, presentations and
// vault, one tab at a time. Opening a brain also makes it the "this brain"
// scope for Search.
export default function BrainScreen() {
  const { ns, tab: initialTab } = useLocalSearchParams<{ ns: string; tab?: Tab }>();
  const { t } = useI18n();
  const { brains, select, loading } = useBrains();
  const [tab, setTab] = useState<Tab>(initialTab === "presentations" || initialTab === "vault" ? initialTab : "notes");
  const brain = brains.find((b) => b.namespace === ns);

  useEffect(() => {
    if (ns) void select(ns);
  }, [ns, select]);

  return (
    <Screen
      header={
        <View>
          <StackHeader
            title={brain?.displayName || ns}
            subtitle={brain ? `${brain.namespace} · ${brain.role}`.toUpperCase() : undefined}
            leading={<BrainAvatar brain={brain ?? { namespace: ns }} size={34} />}
          />
          <FilterStrip<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "notes", label: t("brain.tab.notes") },
              { value: "presentations", label: t("brain.tab.presentations") },
              { value: "vault", label: t("brain.tab.vault") },
            ]}
          />
        </View>
      }
    >
      {!brain ? (
        <Row>
          <AwaitNote text={loading ? t("common.loading") : t("brain.missing")} />
        </Row>
      ) : tab === "notes" ? (
        <BrainNotes brain={brain} />
      ) : tab === "presentations" ? (
        <BrainPresentations brain={brain} />
      ) : (
        <BrainVault brain={brain} />
      )}
    </Screen>
  );
}
