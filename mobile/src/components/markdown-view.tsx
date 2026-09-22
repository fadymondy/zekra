import * as Clipboard from "expo-clipboard";
import { Check, Copy } from "lucide-react-native";
import { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from "react-native";

import { highlight, tokenColor } from "./code-highlight";
import { parseBlocks } from "./markdown-blocks";
import { readingTheme, useReading } from "@/lib/reading-settings";
import { useI18n } from "@/lib/i18n";
import type { ThemePalette } from "@shared/markdown/themes/themes";
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
  // The theme palette is handed on as well as merged: the highlighter buckets
  // token colours from it, and the merged Palette has lost `accent`.
  return { palette, size: reading.fontSize, themePalette: theme?.palette ?? null };
}

/**
 * A fenced block: title bar, syntax highlighting and copy (MH-319).
 *
 * Its own component because it holds state — the copy confirmation — and a
 * hook cannot live inside the switch that renders the other block kinds.
 */
function CodeBlock({
  lines,
  lang,
  label,
  palette,
  themePalette,
  size,
  copyLabel,
}: {
  lines: string[];
  lang: string;
  label: string;
  palette: Palette;
  themePalette: ThemePalette | null;
  size: number;
  copyLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const code = lines.join("\n");
  const tokens = themePalette ? highlight(code, lang) : [{ text: code, scope: "" }];

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    // Revert the tick rather than leaving it: the button is a control, not a
    // status, and a permanent tick reads as "this block is copied".
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View style={[styles.code, { borderColor: palette.line, backgroundColor: palette.soft }]}>
      <View style={[styles.codeBar, { borderColor: palette.line }]}>
        <View style={styles.lights}>
          <View style={[styles.light, { backgroundColor: palette.danger }]} />
          <View style={[styles.light, { backgroundColor: palette.gold }]} />
          <View style={[styles.light, { backgroundColor: palette.ok }]} />
        </View>
        <Text numberOfLines={1} style={{ flex: 1, color: palette.muted, fontFamily: "monospace", fontSize: size - 5 }}>
          {label}
        </Text>
        <Pressable onPress={() => void copy()} accessibilityLabel={copyLabel} hitSlop={8}>
          {copied ? <Check color={palette.ok} size={14} /> : <Copy color={palette.muted} size={14} />}
        </Pressable>
      </View>
      {/* Horizontal scroll rather than wrapping: a wrapped line of code reads
          as two statements. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeBody}>
        <Text style={{ fontFamily: "monospace", fontSize: size - 4, color: palette.ink }}>
          {tokens.map((token, i) => (
            <Text
              key={i}
              style={themePalette ? { color: tokenColor(token.scope, themePalette, palette.ink) } : undefined}
            >
              {token.text}
            </Text>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}

export function MarkdownView({ text, palette: base }: { text: string; palette: Palette }) {
  const { palette, size, themePalette } = useReadingStyle(base);
  const { t } = useI18n();
  const copyLabel = t("code.copy");
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
              <CodeBlock
                key={index}
                lines={block.lines}
                lang={block.lang}
                label={block.label}
                palette={palette}
                themePalette={themePalette}
                size={size}
                copyLabel={copyLabel}
              />
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
  code: { borderWidth: 1 },
  codeBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  lights: { flexDirection: "row", gap: 4 },
  light: { width: 8, height: 8, borderRadius: 4 },
  codeBody: { padding: 10 },
  list: { gap: 4 },
  table: { borderWidth: 1, minWidth: "100%" },
  tableRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { paddingHorizontal: 9, paddingVertical: 6, minWidth: 96, borderRightWidth: StyleSheet.hairlineWidth },
  listRow: { flexDirection: "row", gap: 4 },
});
