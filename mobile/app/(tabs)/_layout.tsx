import { BrainCircuit, FileText, Network, Settings } from "lucide-react-native";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

export default function TabLayout() {
  const p = usePalette();
  const { ready, token } = useAuth();
  if (ready && !token) return <Redirect href="/sign-in" />;
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: p.action,
      tabBarInactiveTintColor: p.muted,
      tabBarStyle: { backgroundColor: p.card, borderTopColor: p.line, borderTopWidth: 1, height: 68, paddingTop: 7 },
      tabBarItemStyle: { borderLeftColor: p.line, borderLeftWidth: 0.5 },
      tabBarLabelStyle: { fontSize: 9, fontWeight: "700", letterSpacing: 1, marginBottom: 6, textTransform: "uppercase" },
    }}>
      <Tabs.Screen name="brains" options={{ title: "Brains", tabBarIcon: ({ color, size }) => <BrainCircuit color={color} size={size} /> }} />
      <Tabs.Screen name="notes" options={{ title: "Notes", tabBarIcon: ({ color, size }) => <FileText color={color} size={size} /> }} />
      <Tabs.Screen name="graph" options={{ title: "Graph", tabBarIcon: ({ color, size }) => <Network color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }} />
    </Tabs>
  );
}
