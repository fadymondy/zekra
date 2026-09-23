import { BadgeCheck, Database, FileKey, KeyRound, Lock, Shield, Terminal, Ticket, type LucideIcon } from "lucide-react-native";

import { kindIcon, type KindIcon as KindIconId } from "./vault-core";

const ICONS: Record<KindIconId, LucideIcon> = {
  shield: Shield,
  "key-round": KeyRound,
  lock: Lock,
  ticket: Ticket,
  terminal: Terminal,
  "file-key": FileKey,
  database: Database,
  "badge-check": BadgeCheck,
};

export function KindIcon({ kind, size = 17, color }: { kind: string | undefined; size?: number; color: string }) {
  const Icon = ICONS[kindIcon(kind)];
  return <Icon size={size} color={color} strokeWidth={1.6} />;
}

/** Wrap a string in Unicode LTR isolates (U+2066 … U+2069) so a secret name,
 *  hint, or path keeps its order inside Arabic text. Display-only: never use it
 *  on text that can be selected or copied, since the marks would travel along. */
export function ltrRun(text: string): string {
  return `\u2066${text}\u2069`;
}
