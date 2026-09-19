import {
  ActivityIcon, BellIcon, BrainIcon, ChartColumnIcon, CircleHelpIcon, DatabaseIcon, DownloadIcon,
  KeyRoundIcon, LayoutGridIcon, LinkIcon, LockIcon, MessagesSquareIcon, NetworkIcon, PlugIcon,
  RocketIcon, SearchIcon, ShieldCheckIcon, UserIcon, UsersIcon, TrashIcon, SettingsIcon,
} from "lucide-react"

import type { NavGroup } from "@/components/shell/app-shell"

// Every signed-in area's sidebar. Labels are dictionary keys; hrefs are locale-relative.

export const BRAINS_NAV: NavGroup[] = [
  { items: [{ href: "/brains", label: "nav.brains", icon: BrainIcon, exact: true }] },
  {
    label: "nav.you",
    items: [
      { href: "/account", label: "nav.account", icon: UserIcon, exact: true },
      { href: "/account/security", label: "nav.security", icon: ShieldCheckIcon },
    ],
  },
]

export function brainNav(namespace: string): NavGroup[] {
  const b = `/b/${encodeURIComponent(namespace)}`
  return [
    {
      items: [
        { href: b, label: "nav.overview", icon: NetworkIcon, exact: true },
        { href: `${b}/chat`, label: "nav.chat", icon: MessagesSquareIcon },
        { href: `${b}/search`, label: "nav.search", icon: SearchIcon },
        { href: `${b}/sources`, label: "nav.sources", icon: PlugIcon },
        { href: `${b}/sessions`, label: "nav.sessions", icon: RocketIcon },
        { href: `${b}/gaps`, label: "nav.gaps", icon: CircleHelpIcon },
        { href: `${b}/activity`, label: "nav.activity", icon: ActivityIcon },
      ],
    },
    {
      label: "nav.settings",
      items: [
        { href: `${b}/secrets`, label: "nav.secrets", icon: LockIcon },
        { href: `${b}/permissions`, label: "nav.permissions", icon: KeyRoundIcon },
      ],
    },
  ]
}

export const ACCOUNT_NAV: NavGroup[] = [
  { items: [{ href: "/brains", label: "nav.brains", icon: BrainIcon, exact: true }] },
  {
    label: "nav.account",
    items: [
      { href: "/account", label: "nav.profile", icon: UserIcon, exact: true },
      { href: "/account/security", label: "nav.security", icon: ShieldCheckIcon },
      { href: "/account/connections", label: "nav.connections", icon: LinkIcon },
      { href: "/account/notifications", label: "nav.notifications", icon: BellIcon },
      { href: "/account/export", label: "nav.export", icon: DownloadIcon },
      { href: "/account/delete", label: "nav.deleteAccount", icon: TrashIcon },
    ],
  },
]

export const ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { href: "/admin", label: "nav.adminOverview", icon: LayoutGridIcon, exact: true },
      { href: "/admin/users", label: "nav.users", icon: UsersIcon },
      { href: "/admin/brains", label: "nav.allBrains", icon: DatabaseIcon },
      { href: "/admin/tokens", label: "nav.tokens", icon: KeyRoundIcon },
      { href: "/admin/search", label: "nav.globalSearch", icon: SearchIcon },
      { href: "/admin/activity", label: "nav.systemActivity", icon: ChartColumnIcon },
    ],
  },
  {
    label: "nav.system",
    items: [{ href: "/admin/settings", label: "nav.settings", icon: SettingsIcon }],
  },
  { label: "nav.you", items: [{ href: "/brains", label: "nav.backToBrains", icon: BrainIcon, exact: true }] },
]
