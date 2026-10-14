import { router } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

import { usePalette } from "@/theme";

// Any link the router can't match (an old or mistyped zekra://… deep link)
// lands here instead of a blank or "Unmatched Route" screen: show progress and
// hand off to the launch route, which goes to Brains or sign-in by session.
export default function NotFound() {
  const p = usePalette();
  useEffect(() => {
    router.replace("/");
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color={p.muted} />
    </View>
  );
}
