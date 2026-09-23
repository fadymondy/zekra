import { Redirect, Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Brain, Search, UserRound, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/components/ui";
import { LiquidGlassTabs } from "@/features/nav/native-tabs";
import { useI18n } from "@/lib/i18n";
import { isLiquidGlass } from "@/lib/platform";
import { useAuth } from "@/providers/auth";
import { fonts, type, usePalette } from "@/theme";

// Expo Router bundles react-navigation internally, so take the tab-bar props
// from `Tabs` itself.
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

// Brains is home: notes, presentations and the vault all live inside a brain,
// as on the web console. Brains and Account are groups with their own stacks
// (app/(tabs)/(brains), app/(tabs)/(account)), so every internal page keeps
// the tab bar. Same order as the iOS 26 native tab bar
// (src/features/nav/native-tabs.tsx).
const TABS: { name: string; label: "nav.search" | "nav.brains" | "nav.account"; Icon: LucideIcon }[] = [
  { name: "(brains)", label: "nav.brains", Icon: Brain },
  { name: "search", label: "nav.search", Icon: Search },
  { name: "(account)", label: "nav.account", Icon: UserRound },
];

// The reference tab bar (SCREENS.md §1.8): card ground, 1px hairline top,
// 9/8 padding over the home-indicator inset, 48px items; icons 23px. Active is
// GOLD at a 1.9 stroke with a 500 label; inactive muted at 1.5 / 400. Gold is
// Zekra's selection colour too, so the violet stays reserved for the one
// primary action per screen. Row direction follows the root layout, so RTL
// mirrors the order.
function TabBar({ state, navigation }: BottomTabBarProps) {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { backgroundColor: p.card, borderTopColor: p.line, paddingBottom: Math.max(insets.bottom, 12) }]}
    >
      {state.routes.map((route, i) => {
        const tab = TABS.find((x) => x.name === route.name);
        if (!tab) return null;
        const active = state.index === i;
        const color = active ? p.gold : p.muted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={t(tab.label)}
            accessibilityState={{ selected: active }}
            onPress={() => {
              const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!active && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            onLongPress={() => navigation.emit({ type: "tabLongPress", target: route.key })}
            style={styles.item}
          >
            <tab.Icon size={23} color={color} strokeWidth={active ? 1.9 : 1.5} />
            <AppText style={{ fontFamily: active ? fonts.medium : fonts.regular, fontSize: isRtl ? type.tab + 1 : type.tab, lineHeight: isRtl ? 19 : 16, color }}>
              {t(tab.label)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// Brains is the home tab for both navigators (NativeTabs has no
// initialRouteName prop; the router applies this to either).
export const unstable_settings = { initialRouteName: "(brains)" };

// iOS 26+ gets the system tab bar with Liquid Glass
// (src/features/nav/native-tabs.tsx); older iOS and Android keep the house
// tab bar above. The gate is the OS version, fixed for the process, so the
// navigator never swaps at runtime.
export default function TabLayout() {
  const { ready, token } = useAuth();
  if (ready && !token) return <Redirect href="/sign-in" />;
  if (isLiquidGlass()) return <LiquidGlassTabs />;
  return (
    <Tabs initialRouteName="(brains)" screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
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
