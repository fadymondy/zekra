import { Redirect } from "expo-router";
import { View } from "react-native";

import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

// Launch route. While the session is being restored the animated splash
// (src/features/splash, mounted over everything by app/_layout.tsx) covers
// this, so it only paints the ground; then it hands off to Brains — the home —
// or to sign-in.
export default function Index() {
  const { ready, token } = useAuth();
  const p = usePalette();
  if (!ready) return <View style={{ flex: 1, backgroundColor: p.bg }} />;
  return <Redirect href={token ? "/brains" : "/sign-in"} />;
}
