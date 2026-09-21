import { Redirect } from "expo-router";

import { StatePanel } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";

export default function Index() {
  const { ready, token } = useAuth();
  const { t } = useI18n();
  // The native splash covers this until `ready` flips (see app/_layout.tsx);
  // this is just the fallback if it is hidden early.
  if (!ready) return <StatePanel loading title={t("app.name")} body={t("common.loading")} />;
  return <Redirect href={token ? "/(tabs)/notes" : "/sign-in"} />;
}
