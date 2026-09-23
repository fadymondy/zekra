import { router, type Href } from "expo-router";
import type { LucideIcon } from "lucide-react-native";
import { Bell, BookOpen, Info, KeyRound, Palette, Plug, ShieldCheck, UserPen } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { ForwardChevron, ListItem, StackHeader, Tile } from "@/components/kit";
import { AppText, Rows, Screen } from "@/components/ui";
import { useI18n, type TKey } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

// Settings is an index (the Settings tab) of pages, one per section. Every page
// carries the same strip of sections under its header, so moving between
// Appearance, Reading, Profile… is one tap, not back-then-forward. Switching
// sections replaces the page rather than stacking it, so Back always returns
// to the index.

export type SettingsSection = "appearance" | "reading" | "notifications" | "security" | "profile" | "password" | "connect" | "about";

export const SECTIONS: { key: SettingsSection; label: TKey; href: Href; Icon: LucideIcon }[] = [
  { key: "appearance", label: "settings.appearance", href: "/settings/appearance", Icon: Palette },
  { key: "reading", label: "settings.x.reading", href: "/settings/reading", Icon: BookOpen },
  { key: "notifications", label: "settings.x.notifications", href: "/settings/notifications", Icon: Bell },
  { key: "security", label: "security.title", href: "/settings/security", Icon: ShieldCheck },
  { key: "profile", label: "account.profile", href: "/account/profile", Icon: UserPen },
  { key: "password", label: "account.password", href: "/account/password", Icon: KeyRound },
  { key: "connect", label: "settings.x.connect", href: "/settings/connect", Icon: Plug },
  { key: "about", label: "settings.x.about", href: "/settings/about", Icon: Info },
];

/** The section strip: every settings page, the current one in gold. It wraps
 *  instead of scrolling sideways, so it lays out correctly in both directions
 *  (a horizontal ScrollView does not follow a root `direction` on iOS). */
function SectionStrip({ current }: { current?: SettingsSection }) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t("settings.x.sections")}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 7, paddingHorizontal: metrics.padX, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: p.line, backgroundColor: p.bg }}
    >
      {SECTIONS.map((s) => {
        const on = s.key === current;
        return (
          <Pressable
            key={s.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (!on) router.replace(s.href);
            }}
            style={({ pressed }) => ({
              minHeight: 34,
              paddingHorizontal: 11,
              borderRadius: metrics.radius.chip,
              borderWidth: 1,
              borderColor: on ? p.gold : p.line,
              backgroundColor: on ? `${p.gold}1A` : pressed ? p.soft : p.card,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            })}
          >
            <s.Icon size={14} color={on ? p.gold : p.muted} strokeWidth={1.6} />
            <AppText style={{ fontFamily: fonts.regular, fontSize: 12.5, color: on ? p.gold : p.muted }}>{t(s.label)}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A settings page: stack header (back to the index) + section strip + rows. */
export function SettingsPage({ section, title, children }: { section?: SettingsSection; title?: string; children: ReactNode }) {
  const { t } = useI18n();
  const entry = SECTIONS.find((s) => s.key === section);
  return (
    <Screen
      scroll
      header={
        <View>
          <StackHeader title={title ?? (entry ? t(entry.label) : t("settings.title"))} onBack={() => router.navigate("/settings")} />
          <SectionStrip current={section} />
        </View>
      }
    >
      <Rows style={{ paddingTop: 16 }}>{children}</Rows>
    </Screen>
  );
}

/** A settings list item (reference Account screen): 34 tile, 13.5 label, chevron. */
export function SettingsItem({ Icon, label, onPress, last, tone, trailing, detail, mono = false }: {
  Icon: LucideIcon;
  label: string;
  onPress?: () => void;
  last?: boolean;
  tone?: "gold" | "danger";
  trailing?: ReactNode;
  detail?: string;
  /** Machine text (URL, host, version): mono, left-to-right. */
  mono?: boolean;
}) {
  const p = usePalette();
  const iconColor = tone === "danger" ? p.danger : tone === "gold" ? p.gold : p.muted;
  return (
    <ListItem
      last={last}
      padV={12}
      onPress={onPress}
      leading={
        <Tile size={34}>
          <Icon size={17} color={iconColor} strokeWidth={1.6} />
        </Tile>
      }
      trailing={trailing ?? (onPress ? <ForwardChevron size={17} /> : undefined)}
    >
      <AppText numberOfLines={1} style={{ fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 21, color: tone === "danger" ? p.danger : p.ink }}>{label}</AppText>
      {detail ? (
        <AppText
          numberOfLines={mono ? 1 : 2}
          style={mono
            ? { fontFamily: fonts.mono, fontSize: 11, lineHeight: 17, color: p.muted, writingDirection: "ltr", alignSelf: "flex-start" }
            : { fontFamily: fonts.light, fontSize: 12, lineHeight: 19, color: p.muted }}
        >
          {detail}
        </AppText>
      ) : null}
    </ListItem>
  );
}

/** A section's 13.5/500 sub-label and optional muted explanation. */
export function SettingsLabel({ title, body }: { title: string; body?: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 3 }}>
      <AppText style={{ fontFamily: fonts.medium, fontSize: 13.5, lineHeight: 21, color: p.ink }}>{title}</AppText>
      {body ? <AppText style={{ fontFamily: fonts.light, fontSize: 12.5, lineHeight: 20, color: p.muted }}>{body}</AppText> : null}
    </View>
  );
}
