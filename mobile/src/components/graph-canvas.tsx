import { router } from "expo-router";
import { ExternalLink, Network } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";

import type { GraphData, GraphNode } from "@/lib/api";
import { graphColors, usePalette } from "@/theme";

const WIDTH = 820;
const HEIGHT = 590;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

type PositionedNode = GraphNode & { x: number; y: number; color: string; radius: number };

function shortLabel(value: string, max = 19) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function arrange(nodes: GraphNode[]): PositionedNode[] {
  if (!nodes.length) return [];
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = node.group || node.type || "entity";
    const bucket = groups.get(key) || [];
    bucket.push(node);
    groups.set(key, bucket);
  }

  const roots = nodes.filter((node) => node.group === "root");
  const ordinaryGroups = [...groups.entries()].filter(([key]) => key !== "root");
  const positioned: PositionedNode[] = roots.map((node, index) => ({
    ...node,
    x: CENTER_X + (index - (roots.length - 1) / 2) * 70,
    y: CENTER_Y,
    color: graphColors[0],
    radius: 22,
  }));

  ordinaryGroups.forEach(([group, items], groupIndex) => {
    const angle = (Math.PI * 2 * groupIndex) / Math.max(ordinaryGroups.length, 1) - Math.PI / 2;
    const groupX = CENTER_X + Math.cos(angle) * 205;
    const groupY = CENTER_Y + Math.sin(angle) * 205;
    const color = graphColors[(groupIndex + 1) % graphColors.length];
    items.forEach((node, nodeIndex) => {
      const localAngle = (Math.PI * 2 * nodeIndex) / Math.max(items.length, 1);
      const localRadius = items.length === 1 ? 0 : Math.min(74, 22 + Math.ceil(items.length / 5) * 11);
      positioned.push({
        ...node,
        x: groupX + Math.cos(localAngle) * localRadius,
        y: groupY + Math.sin(localAngle) * localRadius,
        color,
        radius: node.group === "type" ? 17 : 10,
      });
    });
  });
  return positioned;
}

export function GraphCanvas({ data }: { data: GraphData }) {
  const p = usePalette();
  const nodes = useMemo(() => arrange(data.nodes), [data.nodes]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const connections = selected ? data.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ backgroundColor: p.card }}>
        <Svg width={WIDTH} height={HEIGHT}>
          {data.edges.map((edge, index) => {
            const source = byId.get(edge.source);
            const target = byId.get(edge.target);
            if (!source || !target) return null;
            const highlighted = selectedId === source.id || selectedId === target.id;
            return <Line key={`${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={highlighted ? p.gold : p.line} strokeWidth={highlighted ? 2 : 1} opacity={highlighted ? 0.95 : 0.55} />;
          })}
          {nodes.map((node) => {
            const active = selectedId === node.id;
            return (
              <G key={node.id} onPress={() => setSelectedId((value) => value === node.id ? undefined : node.id)}>
                <Circle cx={node.x} cy={node.y} r={node.radius + (active ? 4 : 0)} fill={node.color} stroke={active ? p.gold : p.card} strokeWidth={active ? 4 : 2} />
                <SvgText x={node.x} y={node.y + node.radius + 15} fontSize="10" fontWeight="600" fill={p.ink} textAnchor="middle">{shortLabel(node.name)}</SvgText>
              </G>
            );
          })}
        </Svg>
      </ScrollView>
      {selected ? (
        <View style={[styles.inspector, { backgroundColor: p.soft, borderColor: p.line }]}>
          <View style={[styles.nodeMark, { backgroundColor: selected.color }]}><Network color="#fff" size={18} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={2} style={[styles.nodeName, { color: p.ink }]}>{selected.name}</Text>
            <Text style={{ color: p.muted, fontSize: 12 }}>{selected.type || selected.group || "entity"} · {connections.length} connection{connections.length === 1 ? "" : "s"}</Text>
          </View>
          {selected.noteId ? (
            <Pressable onPress={() => router.push({ pathname: "/note/[id]", params: { id: selected.noteId! } })} style={[styles.open, { backgroundColor: p.action }]}>
              <ExternalLink color={p.onAction} size={18} />
            </Pressable>
          ) : null}
        </View>
      ) : <Text style={[styles.help, { color: p.muted }]}>Tap a node to inspect its connections.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  inspector: { minHeight: 74, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 15, paddingVertical: 10 },
  nodeMark: { width: 38, height: 38, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  nodeName: { fontSize: 15, fontWeight: "700" },
  open: { width: 40, height: 40, borderRadius: 0, alignItems: "center", justifyContent: "center" },
  help: { textAlign: "center", padding: 15, fontSize: 12 },
});
