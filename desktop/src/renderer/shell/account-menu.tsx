import type { MouseEvent } from "react";
import { UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { SEP, showMenu } from "../lib/native-menu";
import { useRunCommand } from "./commands";
import { useSession } from "./session";

/*
The account lives where Health Debug keeps it: in the SETTINGS window
(Settings ▸ Account — profile, password, sign out), with a trailing avatar in
the window's toolbar as the shortcut to it — a native menu with who is signed
in, Account Settings…, Connect AI Tools…, Settings… and Sign Out. It is not in
the sidebar (a source list is for places, not for the account).
*/

/** Up to two initials from a name, else the email's first letter. */
export function initialsOf(user: { name?: string; email?: string } | null): string {
  const name = user?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  return (user?.email?.[0] ?? "").toUpperCase();
}

/** The signed-in account's monogram (shadcn Avatar on the theme's primary). */
export function AccountAvatar({ size = 22 }: { size?: number }) {
  const { user } = useSession();
  const initials = initialsOf(user);
  return (
    <Avatar aria-hidden className="after:hidden" style={{ width: size, height: size }}>
      <AvatarFallback className="bg-primary font-semibold text-primary-foreground" style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}>
        {initials || <UserRound className="size-3/5" />}
      </AvatarFallback>
    </Avatar>
  );
}

/** The toolbar's trailing avatar: the account's native menu. */
export function AccountButton() {
  const { t } = useI18n();
  const { user } = useSession();
  const run = useRunCommand();
  if (!user) return null;

  function open(e: MouseEvent<HTMLButtonElement>) {
    const el = e.currentTarget;
    void showMenu(
      [
        { id: "who", label: user?.name || user?.email || "", enabled: false },
        ...(user?.name && user.email ? [{ id: "email", label: user.email, enabled: false }] : []),
        SEP,
        { id: "account", label: t("win.account.settings") },
        { id: "connect", label: t("win.account.connect") },
        { id: "settings", label: t("win.account.allSettings"), accelerator: "CmdOrCtrl+," },
        SEP,
        { id: "sign-out", label: t("win.account.signOut") },
      ],
      el,
    ).then((id) => {
      if (id === "account" || id === "connect") void bridge().openSettingsWindow?.(id);
      else if (id === "settings") void bridge().openSettingsWindow?.("general");
      else if (id === "sign-out") run("sign-out");
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      data-ctl="icon-sm"
      aria-label={t("win.account.button")}
      title={user.email}
      onClick={open}
      className="rounded-full hover:bg-hover"
    >
      <AccountAvatar size={22} />
    </Button>
  );
}
