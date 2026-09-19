import { CircleUser, LogOut, User as UserIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@togo-framework/ui";
import { useSession } from "../routes/auth-gate";
import { auth } from "../lib/auth";

/** The signed-in account, as Managy draws it: an icon button opening "Signed in as <email>",
 * the profile page and sign-out. Renders nothing when auth is off. Sign out clears the
 * session then reloads so the AuthGate re-evaluates. */
export function UserMenu() {
  const { me } = useSession();
  const nav = useNavigate();
  if (!me) return null;
  const email = me.email || "signed in";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Account">
          <UserIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>
          <span className="grid-micro block">Signed in as</span>
          <span dir="ltr" className="mt-1 block truncate text-sm font-normal text-grid-fg">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav({ to: "/profile" })}>
          <CircleUser className="h-4 w-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={async () => { await auth.logout(); window.location.reload(); }}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
