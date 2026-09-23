import { Stack } from "expo-router";

import { isLiquidGlass } from "@/lib/platform";

// The Search tab's own stack. On iOS 26+ this is what makes the Apple-Health
// style search work: the tab is the system search tab (role="search",
// src/features/nav/native-tabs.tsx) and iOS hosts the search controller of
// this stack's root screen (headerSearchBarOptions, set by
// src/features/search/native-search.tsx) as the Liquid Glass field at the
// bottom. Elsewhere it is a header-less pass-through to the house screen, so
// /(tabs)/search behaves as before.
export default function SearchLayout() {
  return <Stack screenOptions={{ headerShown: isLiquidGlass() }} />;
}
