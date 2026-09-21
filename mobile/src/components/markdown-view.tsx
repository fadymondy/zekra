import { Linking, StyleSheet, Text, View, type TextStyle } from "react-native";

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

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "code"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; text: string };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) { codeLines.push(lines[i]); i += 1; }
      i += 1;
      blocks.push({ kind: "code", lines: codeLines });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    if (heading) { blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] }); i += 1; continue; }
    if (/^>\s?/.test(line)) { blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "") }); i += 1; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) { blocks.push({ kind: "rule" }); i += 1; continue; }
    const ordered = line.match(/^\s*\d+\.\s+(.*)/);
    const unordered = line.match(/^\s*[-*]\s+(.*)/);
    if (ordered || unordered) {
      const isOrdered = !!ordered;
      const items: string[] = [(ordered || unordered)![1]];
      i += 1;
      while (i < lines.length) {
        const next = isOrdered ? lines[i].match(/^\s*\d+\.\s+(.*)/) : lines[i].match(/^\s*[-*]\s+(.*)/);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }
    if (line.trim() === "") { i += 1; continue; }
    blocks.push({ kind: "paragraph", text: line });
    i += 1;
  }
  return blocks;
}

export function MarkdownView({ text, palette }: { text: string; palette: Palette }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) return <Text style={{ color: palette.muted }}>Nothing written yet.</Text>;
  return (
    <View style={styles.wrap}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
            const sizes = { 1: 20, 2: 17, 3: 15 } as const;
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
                <Text style={{ fontFamily: "monospace", fontSize: 12, color: palette.ink }}>{block.lines.join("\n")}</Text>
              </View>
            );
          case "list":
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, i) => (
                  <View key={i} style={styles.listRow}>
                    <Text style={{ color: palette.muted, width: 20 }}>{block.ordered ? `${i + 1}.` : "•"}</Text>
                    <View style={{ flex: 1 }}><Text style={{ color: palette.body }}><Inline line={item} palette={palette} /></Text></View>
                  </View>
                ))}
              </View>
            );
          case "paragraph":
          default:
            return <Text key={index} style={{ color: palette.body, lineHeight: 21 }}><Inline line={block.text} palette={palette} /></Text>;
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
  listRow: { flexDirection: "row", gap: 4 },
});
