"use no memo";

import type { JSX } from "react";
import { FlexWidget, TextWidget, type ColorProp, type WidgetRepresentation } from "react-native-android-widget";

import { WIDGET_PALETTE, dirOrder, moreLabel, type WidgetPalette, type WidgetProps, type WidgetRow, type WidgetStat } from "./widgets-core";

// The Android home-screen widgets (MH-360), drawn by react-native-android-widget
// (plain functions returning its FlexWidget / TextWidget tree — no hooks, no
// components). Three providers, one per size, each resizable and adapting to
// the space it is given:
//   ZekraBrainSmall   (2×2) — the pinned brain: tile, name, memories · recalls · gaps
//   ZekraBrainsMedium (4×2) — the most recent brains (as many as fit) + total memories
//   ZekraBrainsLarge  (4×4) — the Brains-home stats strip + the brains list
// A light and a dark rendering are returned; the launcher shows the one that
// matches the system theme. RTL is laid out by hand (dirOrder): the library
// draws off-screen views that always resolve left-to-right.

/** Names must match the `widgets[].name` of the react-native-android-widget plugin in app.json. */
export const ANDROID_WIDGETS = {
  small: "ZekraBrainSmall",
  medium: "ZekraBrainsMedium",
  large: "ZekraBrainsLarge",
} as const;

export type AndroidWidgetName = (typeof ANDROID_WIDGETS)[keyof typeof ANDROID_WIDGETS];
export const ANDROID_WIDGET_NAMES: AndroidWidgetName[] = Object.values(ANDROID_WIDGETS);

// Copied into the APK by the plugin's `fonts` option (app.json); the library
// falls back to the system font if one is missing.
const FONT = { regular: "Lusail-Regular", medium: "Lusail-Medium", mono: "JetBrainsMono_500Medium" };

const hex = (c: string) => c as ColorProp;

type Size = { width: number; height: number };
type Ctx = { p: WidgetPalette; rtl: boolean };

const tone = (c: Ctx, t: WidgetStat["tone"]) => (t === "ok" ? c.p.ok : t === "warn" ? c.p.warn : c.p.ink);
const textAlign = (c: Ctx) => (c.rtl ? "right" : "left") as "right" | "left";
const cross = (c: Ctx) => (c.rtl ? "flex-end" : "flex-start") as "flex-end" | "flex-start";

function tile(row: Pick<WidgetRow, "glyph" | "mono" | "color">, size: number) {
  return (
    <FlexWidget
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26), backgroundColor: hex(row.color), alignItems: "center", justifyContent: "center" }}
    >
      <TextWidget
        text={row.glyph}
        maxLines={1}
        allowFontScaling={false}
        style={{ fontSize: Math.round(size * (row.mono ? 0.36 : 0.5)), fontFamily: row.mono ? FONT.mono : FONT.medium, color: "#ffffff" }}
      />
    </FlexWidget>
  );
}

function stat(c: Ctx, s: WidgetStat, valueSize: number, flex = 1) {
  return (
    <FlexWidget style={{ flex, flexDirection: "column", alignItems: cross(c) }}>
      <TextWidget text={s.value} maxLines={1} style={{ fontSize: valueSize, fontFamily: FONT.mono, color: hex(tone(c, s.tone)), textAlign: textAlign(c) }} />
      <TextWidget text={s.label} maxLines={1} truncate="END" style={{ fontSize: 11.5, fontFamily: FONT.regular, color: hex(c.p.muted), textAlign: textAlign(c) }} />
    </FlexWidget>
  );
}

function brainRow(c: Ctx, r: WidgetRow, size: number) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: r.url }}
      accessibilityLabel={r.name}
      style={{ width: "match_parent", flexDirection: "row", alignItems: "center", flexGap: 10, paddingVertical: 4 }}
    >
      {dirOrder(
        [
          tile(r, size),
          <FlexWidget style={{ flex: 1, flexDirection: "column", alignItems: cross(c) }}>
            <TextWidget text={r.name} maxLines={1} truncate="END" style={{ fontSize: 13.5, fontFamily: FONT.medium, color: hex(c.p.ink), textAlign: textAlign(c) }} />
            <TextWidget text={r.ago} maxLines={1} style={{ fontSize: 11.5, fontFamily: FONT.regular, color: hex(c.p.muted), textAlign: textAlign(c) }} />
          </FlexWidget>,
          <TextWidget text={r.memories} maxLines={1} style={{ fontSize: 13, fontFamily: FONT.mono, color: hex(c.p.ink) }} />,
        ],
        c.rtl,
      )}
    </FlexWidget>
  );
}

function header(c: Ctx, title: string, trailing: string) {
  return (
    <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
      {dirOrder(
        [
          <TextWidget text={title} maxLines={1} style={{ fontSize: 13.5, fontFamily: FONT.medium, color: hex(c.p.gold) }} />,
          <TextWidget text={trailing} maxLines={1} style={{ fontSize: 12, fontFamily: FONT.mono, color: hex(c.p.muted) }} />,
        ],
        c.rtl,
      )}
    </FlexWidget>
  );
}

function divider(c: Ctx) {
  return <FlexWidget style={{ width: "match_parent", height: 1, backgroundColor: hex(c.p.line), marginBottom: 4 }} />;
}

function shell(c: Ctx, url: string, children: JSX.Element[]) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: url }}
      style={{
        width: "match_parent",
        height: "match_parent",
        flexDirection: "column",
        alignItems: cross(c),
        backgroundColor: hex(c.p.bg),
        borderRadius: 18,
        borderWidth: 1,
        borderColor: hex(c.p.line),
        padding: 12,
      }}
    >
      {children}
    </FlexWidget>
  );
}

/** How many brain rows fit in `height` dp below `used` dp of chrome. */
export function rowsThatFit(height: number, used: number, rowHeight = 36, max = 6): number {
  return Math.max(1, Math.min(max, Math.floor((height - used) / rowHeight)));
}

function message(c: Ctx, props: WidgetProps | null) {
  const title = props?.message?.title ?? "Zekra";
  const body = props?.message?.body ?? "";
  return shell(c, "zekra://", [
    tile({ glyph: "ذ", mono: false, color: c.p.action }, 30),
    <FlexWidget style={{ flex: 1 }} />,
    <TextWidget text={title} maxLines={1} style={{ fontSize: 15, fontFamily: FONT.medium, color: hex(c.p.ink), textAlign: textAlign(c) }} />,
    <TextWidget text={body} maxLines={3} style={{ fontSize: 13, fontFamily: FONT.regular, color: hex(c.p.muted), textAlign: textAlign(c) }} />,
  ]);
}

function small(c: Ctx, props: WidgetProps) {
  const b = props.pinned!;
  return shell(c, b.url, [
    tile(b, 34),
    <FlexWidget style={{ flex: 1 }} />,
    <TextWidget text={b.name} maxLines={1} truncate="END" style={{ fontSize: 15, fontFamily: FONT.medium, color: hex(c.p.ink), textAlign: textAlign(c) }} />,
    <TextWidget text={b.ago} maxLines={1} style={{ fontSize: 12, fontFamily: FONT.regular, color: hex(c.p.muted), textAlign: textAlign(c), marginBottom: 8 }} />,
    <FlexWidget style={{ width: "match_parent", flexDirection: "row", flexGap: 6 }}>
      {dirOrder(b.stats.map((s) => stat(c, s, 14)), c.rtl)}
    </FlexWidget>,
  ]);
}

function medium(c: Ctx, props: WidgetProps, size: Size) {
  const rows = props.rows.slice(0, rowsThatFit(size.height, 24 + 28, 35, 4));
  return shell(c, props.url, [header(c, props.title, props.total), divider(c), ...rows.map((r) => brainRow(c, r, 26))]);
}

function large(c: Ctx, props: WidgetProps, size: Size) {
  const statTile = (s: WidgetStat) => (
    <FlexWidget style={{ flex: 1, backgroundColor: hex(c.p.card), borderRadius: 8, borderWidth: 1, borderColor: hex(c.p.line), paddingHorizontal: 8, paddingVertical: 6 }}>
      {stat(c, s, 15)}
    </FlexWidget>
  );
  const strip = (items: WidgetStat[]) => (
    <FlexWidget style={{ width: "match_parent", flexDirection: "row", flexGap: 6, marginBottom: 6 }}>{dirOrder(items.map(statTile), c.rtl)}</FlexWidget>
  );
  const rows = props.rows.slice(0, rowsThatFit(size.height, 24 + 28 + 104 + 18, 37, 6));
  const more = moreLabel(props, rows.length);
  const footer = more
    ? [<TextWidget text={more} maxLines={1} style={{ fontSize: 11.5, fontFamily: FONT.regular, color: hex(c.p.muted), textAlign: textAlign(c) }} />]
    : [];
  return shell(c, props.url, [
    header(c, props.title, props.updated),
    strip(props.stats.slice(0, 3)),
    strip(props.stats.slice(3)),
    divider(c),
    ...rows.map((r) => brainRow(c, r, 28)),
    <FlexWidget style={{ flex: 1 }} />,
    ...footer,
  ]);
}

function render(name: string, props: WidgetProps | null, size: Size, p: WidgetPalette) {
  const c: Ctx = { p, rtl: !!props?.rtl };
  if (!props || props.state !== "ok" || !props.pinned) return message(c, props);
  if (name === ANDROID_WIDGETS.small) return small(c, props);
  if (name === ANDROID_WIDGETS.medium) return medium(c, props, size);
  return large(c, props, size);
}

/** The widget `name` for `props` at `size` (dp), light and dark. */
export function renderAndroidWidget(name: string, props: WidgetProps | null, size: Size): WidgetRepresentation {
  return { light: render(name, props, size, WIDGET_PALETTE.light), dark: render(name, props, size, WIDGET_PALETTE.dark) };
}
