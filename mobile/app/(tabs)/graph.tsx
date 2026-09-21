import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { BrainPicker } from "@/components/brain-picker";
import { GraphCanvas } from "@/components/graph-canvas";
import { Header, Screen, StatePanel } from "@/components/ui";
import { zekraApi } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { graphColors, usePalette } from "@/theme";

export default function GraphScreen() {
  const p = usePalette();
  const { token } = useAuth();
  const { namespace, current } = useBrains();
  const graph = useQuery({
    queryKey: ["graph", token, namespace],
    queryFn: () => zekraApi.graph(token!, namespace, 180),
    enabled: !!token && !!namespace,
  });

  return (
    <Screen>
      <Header
        eyebrow={current?.displayName || namespace || "Select a brain"}
        title="Graph"
        action={namespace ? <Pressable onPress={() => void graph.refetch()} style={[styles.refresh, { backgroundColor: p.soft }]}><RefreshCw color={p.ink} size={20} /></Pressable> : undefined}
      />
      <BrainPicker />
      {!namespace ? <StatePanel title="Choose a brain" body="Select a brain to explore its connected knowledge." /> : graph.isLoading ? (
        <StatePanel loading title="Mapping the brain" />
      ) : graph.error ? (
        <StatePanel title="Could not load the graph" body={graph.error.message} />
      ) : !graph.data?.ready ? (
        <StatePanel title="Graph is not ready" body="Notes remain available while graph indexing catches up." />
      ) : !graph.data.nodes.length ? (
        <StatePanel title="No connections yet" body="Add and index notes to grow this knowledge graph." />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend}>
            {(graph.data.typeCounts?.length ? graph.data.typeCounts : [...new Set(graph.data.nodes.map((node) => node.group || node.type || "entity"))].map((type) => ({ type, count: graph.data!.nodes.filter((node) => (node.group || node.type || "entity") === type).length }))).map((item, index) => (
              <View key={item.type} style={[styles.legendItem, { borderColor: p.line, backgroundColor: p.card }]}>
                <View style={[styles.dot, { backgroundColor: graphColors[(index + 1) % graphColors.length] }]} />
                <Text style={{ color: p.body, fontSize: 11 }}>{item.type} {item.count}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.summary, { borderBottomColor: p.line }]}>
            <Text style={{ color: p.muted, fontSize: 11 }}>{graph.data.totalNodes ?? graph.data.nodes.length} nodes · {graph.data.totalEdges ?? graph.data.edges.length} links{graph.data.sampled ? " · showing a sample" : ""}</Text>
          </View>
          <GraphCanvas data={graph.data} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  refresh: { width: 42, height: 42, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  legend: { paddingHorizontal: 12, paddingVertical: 9, gap: 7 },
  legendItem: { borderWidth: 1, borderRadius: 0, paddingHorizontal: 9, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 0 },
  summary: { paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
