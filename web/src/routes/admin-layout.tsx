import { AppShell } from "../components/app-shell";
import { HUB_GROUPS } from "../lib/nav";

// Cross-brain admin (users, tokens/ACL, global search) shares the hub's shell and navigation.
export function AdminLayout() {
  return <AppShell groups={HUB_GROUPS} />;
}
