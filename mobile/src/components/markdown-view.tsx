import { Linking, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";

import { parseBlocks } from "./markdown-blocks";
import { readingTheme, useReading } from "@/lib/reading-settings";
import type { Palette } from "@/theme";

// A small, dependency-free markdown renderer for React Native. Zekra notes
// are stored and indexed as plain markdown (plugins/brain/internal/brain/notes.go
// chunks bodies on markdown headings), so this only needs to read markdown —
// there's no editor bridge or HTML round-trip involved, unlike a WebView-based
// rich editor. Covers the subset notes actually use: headings, bold/italic,
// inline code, fenced code, links, blockquotes, lists, and rules.

type Segment = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string };

function splitInline(line: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    if (match.index > last) segments.push({ text: line.slice(last, match.index) });
    if (match[1] !== undefined) segments.push({ text: match[1], code: true });
    else if (match[2] !== undefined) segments.push({ text: match[2], bold: true });
    else if (match[3] !== undefined) segments.push({ text: match[3], italic: true });
    else if (match[4] !== undefined) segments.push({ text: match[4], href: match[5] });
    last = pattern.lastIndex;
  }
  if (last < line.length) segments.push({ text: line.slice(last) });
  return segments;
}

function Inline({ line, palette }: { line: string; palette: Palette }) {
  return (
    <Text>
      {splitInline(line).map((seg, i) => {
        const style: TextStyle = {};
        if (seg.bold) style.fontWeight = "700";
        if (seg.italic) style.fontStyle = "italic";
        if (seg.code) { style.fontFamily = "monospace"; style.backgroundColor = palette.soft; }
        if (seg.href) style.color = palette.action;
        return (
          <Text key={i} style={style} onPress={seg.href ? () => void Linking.openURL(seg.href!) : undefined}>
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

/*
Apply the reading preferences (MH-266).

The reading theme's palette is the web's ThemePalette — bg/fg/border/link and
so on — which does not line up field-for-field with the mobile Palette, so the
five that DO have a counterpart are mapped and the rest of the app palette is
kept. The alternative, a second full palette per theme for RN, is 27 more
tables to keep in sync for colours nothing reads.

Sizes are derived from one setting rather than stored per element: a reader who
wants larger body text wants proportionally larger headings, and storing six
numbers would let them drift into an unreadable combination.
*/
function useReadingStyle(base: Palette) {
  const { reading } = useReading();
  const theme = readingTheme(reading.theme);
  const palette: Palette = theme
    ? {
        ...base,
        bg: theme.palette.bg,
        ink: theme.palette.fg,
        body: theme.palette.fg,
        muted: theme.palette.fgMuted,
        line: theme.palette.border,
        soft: theme.palette.codeBg,
        action: theme.palette.link,
      }
    : base;
  return { palette, size: reading.fontSize };
}

export function MarkdownView({ text, palette: base }: { text: string; palette: Palette }) {
  const { palette, size } = useReadingStyle(base);
  const blocks = parseBlocks(text);
  if (!blocks.length) return <Text style={{ color: palette.muted }}>Nothing written yet.</Text>;
  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const sizes = { 1: size + 4, 2: size + 1, 3: size - 1 } as const;
            return <Text key={index} style={{ color: palette.ink, fontSize: sizes[block.level], fontWeight: "700" }}><Inline line={block.text} palette={palette} /></Text>;
          }
          case "quote":
            return (
              <View key={index} style={[styles.quote, { borderColor: palette.line }]}>
                <Text style={{ color: palette.muted }}><Inline line={block.text} palette={palette} /></Text>
              </View>
            );
          case "rule":
            return <View key={index} style={[styles.rule, { backgroundColor: palette.line }]} />;
          case "code":
            return (
              <View key={index} style={[styles.code, { borderColor: palette.line, backgroundColor: palette.soft }]}>
                <Text style={{ fontFamily: "monospace", fontSize: size - 4, color: palette.ink }}>{block.lines.join("\n")}</Text>
              </View>
            );
          case "list":
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, i) => (
                  <View key={i} style={styles.listRow}>
                    <Text style={{ color: palette.muted, width: 20 }}>{block.ordered ? `${i + 1}.` : "•"}</Text>
                    <View style={{ flex: 1 }}><Text style={{ color: palette.body, fontSize: size }}><Inline line={item} palette={palette} /></Text></View>
                  </View>
                ))}
              </View>
            );
          case "table":
            return (
              <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false}>
                <View style={[styles.table, { borderColor: palette.line }]}>
                  <View style={[styles.tableRow, { backgroundColor: palette.soft, borderColor: palette.line }]}>
                    {block.header.map((cell, c) => (
                      <View key={c} style={[styles.cell, { borderColor: palette.line }]}>
                        <Text style={{ color: palette.ink, fontSize: size - 2, fontWeight: "700" }}>
                          <Inline line={cell} palette={palette} />
                        </Text>
                      </View>
                    ))}
                  </View>
                  {block.rows.map((row, r) => (
                    <View
                      key={r}
                      // Zebra striping, as the web table does — it is what makes
                      // a wide row readable when it scrolls past the edge.
                      style={[
                        styles.tableRow,
                        { borderColor: palette.line, backgroundColor: r % 2 ? palette.soft : "transparent" },
                      ]}
                    >
                      {row.map((cell, c) => (
                        <View key={c} style={[styles.cell, { borderColor: palette.line }]}>
                          <Text style={{ color: palette.body, fontSize: size - 2 }}>
                            <Inline line={cell} palette={palette} />
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          case "paragraph":
          default:
            return <Text key={index} style={{ color: palette.body, fontSize: size, lineHeight: Math.round(size * 1.45) }}><Inline line={block.text} palette={palette} /></Text>;
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  quote: { borderLeftWidth: 2, paddingLeft: 10 },
  rule: { height: StyleSheet.hairlineWidth },
  code: { borderWidth: 1, padding: 10 },
  list: { gap: 4 },
  table: { borderWidth: 1, minWidth: "100%" },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { paddingHorizontal: 9, paddingVertical: 6, minWidth: 96, borderRightWidth: StyleSheet.hairlineWidth },
  listRow: { flexDirection: "row", gap: 4 },
});
