import { Redirect, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { BrainCircuit, FileText, Search, Settings, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, type, usePalette } from "@/theme";

// Expo Router bundles react-navigation internally, so take the tab-bar props
// from `Tabs` itself.
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TABS: { name: string; label: "nav.notes" | "nav.search" | "nav.brains" | "nav.settings"; Icon: LucideIcon }[] = [
  { name: "notes", label: "nav.notes", Icon: FileText },
  { name: "search", label: "nav.search", Icon: Search },
  { name: "brains", label: "nav.brains", Icon: BrainCircuit },
  { name: "settings", label: "nav.settings", Icon: Settings },
];

// The design's tab bar (ported from fadymondy.com-v2/mobile): card ground,
// hairline top, accented active item at 1.9 stroke, muted inactive at 1.5.
// Row direction follows the layout direction, so RTL mirrors it.
function TabBar({ state, navigation }: BottomTabBarProps) {
  const p = usePalette();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: p.card, borderTopColor: p.line, paddingBottom: Math.max(insets.bottom, 12) }]}>
      {state.routes.map((route, i) => {
        const tab = TABS.find((x) => x.name === route.name);
        if (!tab) return null;
        const active = state.index === i;
        const color = active ? p.action : p.muted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!active && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            style={styles.item}
          >
            <tab.Icon size={23} color={color} strokeWidth={active ? 1.9 : 1.5} />
            <AppText style={{ fontFamily: active ? fonts.medium : fonts.regular, fontSize: type.tab, color }}>
              {t(tab.label)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { ready, token } = useAuth();
  if (ready && !token) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: 1, paddingTop: 9, paddingHorizontal: 8 },
  item: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 5 },
});
