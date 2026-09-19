import { AppShell } from "../components/app-shell";
import { HUB_GROUPS } from "../lib/nav";

// The brain hub is the entry point: the Brains index, with cross-brain admin in its own group.
export function HubLayout() {
  return <AppShell groups={HUB_GROUPS} />;
}
