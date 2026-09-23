import { Bell, LogOut, Plug, Settings as SettingsIcon, UserRound } from "lucide-react";

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

/** The signed-in account's monogram (violet, like the web console's user menu). */
export function AccountAvatar({ size = 22 }: { size?: number }) {
  const { user } = useSession();
  const initials = initialsOf(user);
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {initials || <UserRound className="size-3/5" />}
    </span>
  );
}

/** Default occupant of the "titlebar.account" slot (after web's user-menu). */
export function AccountMenu() {
  const { t } = useI18n();
  const { user } = useSession();
  const { navigate } = useRouter();
  const run = useRunCommand();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("shell.account")} title={user?.email} />}>
        <AccountAvatar />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3">
            <AccountAvatar size={32} />
            <span className="min-w-0 flex-1">
              {user?.name ? <span className="block truncate text-sm font-medium text-grid-fg">{user.name}</span> : null}
              <span
                dir="ltr"
                className="block truncate font-grid-mono text-xs text-grid-muted"
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
