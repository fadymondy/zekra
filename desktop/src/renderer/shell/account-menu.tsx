import type { ReactElement } from "react";
import { Bell, LogOut, Plug, Settings as SettingsIcon, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useI18n } from "../lib/i18n";
import { useRunCommand } from "./commands";
import { useRouter } from "./router";
import { useSession } from "./session";

/** Up to two initials from a name, else the email's first letter. */
export function initialsOf(user: { name?: string; email?: string } | null): string {
  const name = user?.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  }
  return (user?.email?.[0] ?? "").toUpperCase();
}

/** The signed-in account's monogram (shadcn Avatar on the theme's primary,
 *  like the web console's user menu). */
export function AccountAvatar({ size = 22 }: { size?: number }) {
  const { user } = useSession();
  const initials = initialsOf(user);
  return (
    <Avatar aria-hidden className="after:hidden" style={{ width: size, height: size }}>
      <AvatarFallback
        className="bg-primary font-semibold text-primary-foreground"
        style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}
      >
        {initials || <UserRound className="size-3/5" />}
      </AvatarFallback>
    </Avatar>
  );
}

/** The account menu (after web's user-menu). By default an avatar button;
 *  the sidebar footer passes its own full-width row as `trigger`. */
export function AccountMenu({ trigger, side = "bottom", align = "end" }: {
  trigger?: ReactElement;
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const { user } = useSession();
  const { navigate } = useRouter();
  const run = useRunCommand();
  return (
    <DropdownMenu>
      {trigger ? (
        <DropdownMenuTrigger render={trigger} />
      ) : (
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("shell.account")} title={user?.email} />}>
          <AccountAvatar />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent side={side} align={align} className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3">
            <AccountAvatar size={32} />
            <span className="min-w-0 flex-1">
              {user?.name ? <span className="block truncate text-[13px] font-medium text-foreground">{user.name}</span> : null}
              <span
                dir="ltr"
                className="block truncate text-xs font-normal text-muted-foreground"
                style={{ unicodeBidi: "isolate" }}
              >
                {user?.email ?? t("shell.signedOut")}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => navigate({ name: "settings", section: "account" })}>
            <UserRound />
            {t("settings.section.account")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ name: "notifications" })}>
            <Bell />
            {t("nav.notifications")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ name: "settings", section: "connect" })}>
            <Plug />
            {t("settings.section.connect")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run("settings")}>
            <SettingsIcon />
            {t("nav.settings")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => run("sign-out")}>
          <LogOut />
          {t("action.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
