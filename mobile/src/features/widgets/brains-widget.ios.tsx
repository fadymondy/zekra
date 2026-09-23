import { Divider, HStack, Link, RoundedRectangle, Spacer, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  padding,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

import type { WidgetProps } from "./widgets-core";

// The iOS home-screen widget (MH-360), rendered by expo-widgets from Expo UI
// (SwiftUI) components. One widget kind, three families:
//   systemSmall  — the pinned brain (last opened in the app, else most recent):
//                  colour tile, name, memories · recalls · open gaps
//   systemMedium — the three most recent brains + total memories
//   systemLarge  — the Brains-home stats strip + the four most recent brains
//
// The 'widget' directive makes babel-preset-expo serialise this function into
// a string that the widget extension evaluates in its own JavaScriptCore
// runtime. So it must be self-contained: no imports, no module-scope values —
// helpers and palette live INSIDE the function (keep the palette in step with
// WIDGET_PALETTE in widgets-core.ts), and every string arrives pre-translated
// in `props` (see widgets-core.ts buildWidgetProps).
//
// RTL is laid out by hand (`order`, `lead`): the extension has no Arabic
// localisation, so SwiftUI lays it out left-to-right even for Arabic.
//
// Inside the function: `line` = a full-width row with its content at the
// reading-start edge; the first branch is the placeholder / signed-out / empty
// state; the last branch is systemLarge (and anything bigger). Children are
// never null — the native side expects every child to be a view node — hence
// `footer` as an array. (No comments inside the function: it is serialised.)

const ZekraBrainsWidget = (props: WidgetProps, env: WidgetEnvironment) => {
  "widget";
  const dark = env.colorScheme === "dark";
  const P = dark
    ? { bg: "#0b1429", card: "#0e1a3c", line: "#25355c", ink: "#f0ebe1", muted: "#8a97b8", action: "#6d4de6", gold: "#c9a227", ok: "#4e9a3e", warn: "#c9a227" }
    : { bg: "#f0ebe1", card: "#f7f4ea", line: "#c7bea9", ink: "#0e1a3c", muted: "#6e6551", action: "#6d4de6", gold: "#c9a227", ok: "#4e9a3e", warn: "#c9a227" };
  const p = props && props.state ? props : null;
  const rtl = !!(p && p.rtl);
  const family = env.widgetFamily;
  const lead = rtl ? "trailing" : "leading";
  const order = (items: any[]) => (rtl ? items.slice().reverse() : items);
  const toneColor = (tone: string) => (tone === "ok" ? P.ok : tone === "warn" ? P.warn : P.ink);

  const line = (content: any) => <HStack spacing={0}>{order([content, <Spacer minLength={0} />])}</HStack>;

  const tile = (row: { glyph: string; mono: boolean; color: string }, size: number) => (
    <ZStack modifiers={[frame({ width: size, height: size })]}>
      <RoundedRectangle cornerRadius={Math.round(size * 0.26)} modifiers={[foregroundStyle(row.color)]} />
      <Text
        modifiers={[
          font({ size: Math.round(size * (row.mono ? 0.38 : 0.5)), weight: "semibold", design: row.mono ? "monospaced" : "default" }),
          foregroundStyle("#ffffff"),
          lineLimit(1),
        ]}
      >
        {row.glyph}
      </Text>
    </ZStack>
  );

  const stat = (s: { label: string; value: string; tone: string }, valueSize: number) => (
    <VStack alignment={lead} spacing={1}>
      <Text modifiers={[font({ size: valueSize, weight: "medium", design: "monospaced" }), foregroundStyle(toneColor(s.tone)), lineLimit(1), minimumScaleFactor(0.6)]}>
        {s.value}
      </Text>
      <Text modifiers={[font({ size: 11.5 }), foregroundStyle(P.muted), lineLimit(1), minimumScaleFactor(0.7)]}>{s.label}</Text>
    </VStack>
  );

  const brainRow = (r: WidgetProps["rows"][number], size: number) => (
    <Link destination={r.url}>
      <HStack spacing={8}>
        {order([
          tile(r, size),
          <VStack alignment={lead} spacing={1}>
            <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(P.ink), lineLimit(1)]}>{r.name}</Text>
            <Text modifiers={[font({ size: 11.5 }), foregroundStyle(P.muted), lineLimit(1), minimumScaleFactor(0.85)]}>{r.ago}</Text>
          </VStack>,
          <Spacer minLength={4} />,
          <Text modifiers={[font({ size: 13, weight: "medium", design: "monospaced" }), foregroundStyle(P.ink), lineLimit(1)]}>{r.memories}</Text>,
        ])}
      </HStack>
    </Link>
  );

  const header = (trailing: string) => (
    <HStack spacing={6}>
      {order([
        <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundStyle(P.gold), lineLimit(1)]}>{p ? p.title : "Zekra"}</Text>,
        <Spacer minLength={4} />,
        <Text modifiers={[font({ size: 12, design: "monospaced" }), foregroundStyle(P.muted), lineLimit(1), minimumScaleFactor(0.7)]}>{trailing}</Text>,
      ])}
    </HStack>
  );

  const shell = (content: any, url: string) => (
    <VStack alignment={lead} spacing={0} modifiers={[containerBackground(P.bg, "widget"), background(P.bg), widgetURL(url)]}>
      {content}
    </VStack>
  );

  if (!p || p.state !== "ok" || !p.pinned) {
    const title = p && p.message ? p.message.title : "Zekra";
    const body = p && p.message ? p.message.body : "";
    return shell(
      <VStack alignment={lead} spacing={6}>
        {line(tile({ glyph: "ذ", mono: false, color: P.action }, 30))}
        <Spacer minLength={0} />
        {line(<Text modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(P.ink), lineLimit(1)]}>{title}</Text>)}
        {line(<Text modifiers={[font({ size: 13 }), foregroundStyle(P.muted), lineLimit(3)]}>{body}</Text>)}
      </VStack>,
      "zekra://",
    );
  }

  if (family === "systemSmall") {
    const b = p.pinned;
    return shell(
      <VStack alignment={lead} spacing={4}>
        {line(tile(b, 30))}
        <Spacer minLength={2} />
        {line(<Text modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle(P.ink), lineLimit(1), minimumScaleFactor(0.8)]}>{b.name}</Text>)}
        {line(<Text modifiers={[font({ size: 12 }), foregroundStyle(P.muted), lineLimit(1)]}>{b.ago}</Text>)}
        <Spacer minLength={4} />
        <HStack spacing={6} alignment="top">
          {order([stat(b.stats[0], 14), <Spacer minLength={0} />, stat(b.stats[1], 14), <Spacer minLength={0} />, stat(b.stats[2], 14)])}
        </HStack>
      </VStack>,
      b.url,
    );
  }

  if (family === "systemMedium") {
    const rows = p.rows.slice(0, 3);
    return shell(
      <VStack alignment={lead} spacing={5}>
        {header(p.total)}
        <Divider modifiers={[foregroundStyle(P.line)]} />
        {rows.map((r) => brainRow(r, 22))}
        <Spacer minLength={0} />
      </VStack>,
      p.url,
    );
  }

  const rows = p.rows.slice(0, 4);
  const statTile = (s: { label: string; value: string; tone: string }) => (
    <VStack alignment={lead} spacing={0} modifiers={[padding({ horizontal: 8, vertical: 6 }), background(P.card), clipShape("roundedRectangle", 8)]}>
      {line(stat(s, 15))}
    </VStack>
  );
  const hidden = p.brainCount - rows.length;
  const more = hidden > 0 ? p.moreTemplate.replace("{count}", String(hidden)) : "";
  const footer = more ? [line(<Text modifiers={[font({ size: 11.5 }), foregroundStyle(P.muted), lineLimit(1)]}>{more}</Text>)] : [];
  return shell(
    <VStack alignment={lead} spacing={6}>
      {header(p.updated)}
      <HStack spacing={6}>{order([statTile(p.stats[0]), statTile(p.stats[1]), statTile(p.stats[2])])}</HStack>
      <HStack spacing={6}>{order([statTile(p.stats[3]), statTile(p.stats[4])])}</HStack>
      <Divider modifiers={[foregroundStyle(P.line)]} />
      {rows.map((r) => brainRow(r, 24))}
      <Spacer minLength={0} />
      {footer}
    </VStack>,
    p.url,
  );
};

/** Name must match the `widgets[].name` of the expo-widgets plugin in app.json. */
export const IOS_WIDGET_NAME = "ZekraBrains";

// Creating the widget stores its layout in the App Group, which the extension
// reads — so this must run in every app process that updates the widget.
const brainsWidget = createWidget<WidgetProps>(IOS_WIDGET_NAME, ZekraBrainsWidget);

/** Props as the App Group store accepts them. expo-widgets saves the timeline
 *  with UserDefaults, which only takes property-list values: a single `null`
 *  (JSON null → NSNull) makes it throw "Exception in HostFunction" and the
 *  widget never gets any data. The layout treats a missing field like null. */
function plistSafe(props: WidgetProps): WidgetProps {
  return JSON.parse(JSON.stringify(props, (_key, value) => (value === null ? undefined : value))) as WidgetProps;
}

/** Replace the widget's timeline (and so reload it). */
export function updateIosWidget(entries: { date: Date; props: WidgetProps }[]): void {
  brainsWidget.updateTimeline(entries.map((e) => ({ date: e.date, props: plistSafe(e.props) })));
}
