import { Redirect } from "expo-router";

import { StatePanel } from "@/components/ui";
import { useAuth } from "@/providers/auth";

export default function Index() {
  const { ready, token } = useAuth();
  if (!ready) return <StatePanel loading title="Opening Zekra" body="Restoring your encrypted session…" />;
  return <Redirect href={token ? "/(tabs)/notes" : "/sign-in"} />;
}
