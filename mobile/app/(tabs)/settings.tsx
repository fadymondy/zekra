import Constants from "expo-constants";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { Globe2, LockKeyhole, Server, UserRound } from "lucide-react-native";
import type { ReactNode } from "react";

import { Button, Header, Screen } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useAuth } from "@/providers/auth";
import { useBrains } from "@/providers/brains";
import { usePalette } from "@/theme";

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={[styles.row, { borderBottomColor: p.line }]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.label, { color: p.muted }]}>{label.toUpperCase()}</Text>
        <Text selectable numberOfLines={2} style={[styles.value, { color: p.ink }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const p = usePalette();
  const { user, signOut } = useAuth();
  const { current } = useBrains();
  const version = Constants.expoConfig?.version || "development";

  return (
    <Screen>
      <Header title="Settings" eyebrow="Zekra mobile" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}>
          <Row icon={<UserRound color={p.action} size={21} />} label="Signed in as" value={user?.email || user?.name || "Zekra user"} />
          <Row icon={<LockKeyhole color={p.gold} size={21} />} label="Active brain" value={current ? `${current.displayName || current.namespace} (${current.role})` : "None selected"} />
          <Row icon={<Server color={p.ok} size={21} />} label="API" value={API_URL} />
          <Row icon={<Globe2 color={p.muted} size={21} />} label="App version" value={version} />
        </View>

        <View style={[styles.notice, { backgroundColor: p.soft, borderColor: p.line }]}>
          <Text style={[styles.noticeTitle, { color: p.ink }]}>Your session stays on this device</Text>
          <Text style={{ color: p.body, lineHeight: 20 }}>The access token is stored in the iOS Keychain or Android Keystore through Expo SecureStore. Notes are read from and saved directly to your Zekra account.</Text>
        </View>

        <Button label="Open web console" tone="quiet" onPress={() => void Linking.openURL(API_URL)} />
        <Button label="Sign out" tone="danger" onPress={() => void signOut()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 17, gap: 16, paddingBottom: 40 },
  card: { borderWidth: 1, borderRadius: 0, overflow: "hidden" },
  row: { minHeight: 72, paddingHorizontal: 15, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 9, letterSpacing: 1.4, fontWeight: "700" },
  value: { fontSize: 14, lineHeight: 19 },
  notice: { borderWidth: 1, borderRadius: 0, padding: 15, gap: 6 },
  noticeTitle: { fontWeight: "700", fontSize: 15 },
});
