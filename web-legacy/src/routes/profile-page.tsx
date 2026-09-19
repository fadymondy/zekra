import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  ProfileView,
  Button, Input, Label,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@togo-framework/ui";
import { useSession } from "./auth-gate";
import { auth } from "../lib/auth";
import { Notice, Page, PageBody, RecallSquares } from "../components/page";

// Change-password dialog — the one profile action wired to a real endpoint
// (POST /api/auth/change-password). The others (avatar, 2FA, session revoke) have
// no backend yet, so ProfileView renders without those callbacks.
function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const reset = () => { setOldPw(""); setNewPw(""); setConfirm(""); setError(""); setDone(false); setBusy(false); };
  const close = () => { reset(); onClose(); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPw !== confirm) { setError("New passwords do not match."); return; }
    setBusy(true);
    try {
      await auth.changePassword(oldPw, newPw);
      setDone(true);
      setTimeout(close, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cur">Current password</Label>
            <Input id="cur" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">New password</Label>
            <Input id="new" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf">Confirm new password</Label>
            <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          {done && <Notice tone="ok">Password updated.</Notice>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={busy || done}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProfilePage() {
  const { me, loading } = useSession();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <Page>
      <div className="px-6 pt-6">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-grid-muted hover:text-grid-fg">
          <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> Back to brains
        </Link>
      </div>

      <PageBody className="py-6">

      {loading ? (
        <p className="flex items-center gap-3 text-sm text-muted-foreground"><RecallSquares /> Loading your profile…</p>
      ) : !me ? (
        <p className="text-sm text-muted-foreground">You are not signed in.</p>
      ) : (
        <ProfileView
          user={{
            email: me.email,
            name: me.email?.split("@")[0],
            roles: Array.isArray(me.roles) ? me.roles.filter(Boolean) : [],
          }}
          onChangePassword={() => setPwOpen(true)}
        />
      )}
      </PageBody>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </Page>
  );
}
