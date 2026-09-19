import { Database, Users, KeyRound, Search } from "lucide-react";
import type { NavGroup } from "../components/app-shell";

// The hub and admin sidebars: the Brains hub, plus cross-brain admin kept out of the brain flow.
export const HUB_GROUPS: NavGroup[] = [
  { items: [{ to: "/", label: "Brains", icon: Database, exact: true }] },
  {
    label: "Admin",
    items: [
      { to: "/admin/users", label: "Users", icon: Users },
      { to: "/admin/tokens", label: "Tokens & ACL", icon: KeyRound },
      { to: "/admin/search", label: "Global search", icon: Search },
    ],
  },
];
