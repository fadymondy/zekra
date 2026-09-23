import { useEffect, useRef } from "react";

import { loadRecent } from "@/lib/notes/recent-notes";

import type { ExportFormat, TrayRecentNote } from "../../../shared/ipc";
import { zekraApi } from "../../lib/api";
import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useCommand } from "../../shell/commands";
import { useRouter } from "../../shell/router";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { exportNote } from "../editor/export";

/*
The rest of Mark It Down's native desktop behaviour (MH-450), renderer side:

  ActiveNoteExport  File ▸ Export ▸ md/html/pdf/docx/png/txt for the ACTIVE
                    note, through the notes engineer's exportNote(). A fallback
                    under any screen that registers its own export handlers
                    (the stack's latest handler wins). "Active" = the most
                    recently opened note of the brain on screen — the
                    workspace records every open in the shared recent-notes
                    store — fetched fresh, so what was last SAVED is exported.
  TrayRecentSync    keeps the menubar's "Recent Notes" (last 5) in step with
                    that same store.
(The "Restart to update" toast moved to features/updates/update-host.tsx.)
*/

export function ActiveNoteExport() {
  const { t } = useI18n();
  const { token } = useSession();
  const { route } = useRouter();

  async function run(format: ExportFormat) {
    const ns = route.name === "brain" ? route.ns : null;
    const recent = ns ? loadRecent().find((r) => r.namespace === ns) : undefined;
    const id = route.name === "brain" ? (recent?.id ?? route.noteId) : undefined;
    if (!token || !id) {
      toast(t("exp.noNote"));
      return;
    }
    try {
      const note = await zekraApi.note(token, id);
      const res = await exportNote(note, format);
      if (!res.canceled) toast.success(t("exp.done"), { description: res.path });
    } catch (e) {
      toast.error(t("exp.failed"), { description: e instanceof Error ? e.message : String(e) });
    }
  }

  const signedIn = Boolean(token);
  useCommand("export:md", () => void run("md"), signedIn);
  useCommand("export:html", () => void run("html"), signedIn);
  useCommand("export:pdf", () => void run("pdf"), signedIn);
  useCommand("export:docx", () => void run("docx"), signedIn);
  useCommand("export:png", () => void run("png"), signedIn);
  useCommand("export:txt", () => void run("txt"), signedIn);
  return null;
}

export function TrayRecentSync() {
  const { user } = useSession();
  const { route } = useRouter();
  const last = useRef("");

  useEffect(() => {
    const push = () => {
      const items: TrayRecentNote[] = user
        ? loadRecent()
            .slice(0, 8)
            .map((r) => ({ id: r.id, namespace: r.namespace, title: r.title }))
        : [];
      const key = JSON.stringify(items);
      if (key === last.current) return;
      last.current = key;
      void bridge().setTrayRecent?.(items);
    };
    push();
    // The workspace writes the store on every open; there is no in-window
    // storage event, so poll lightly and on focus.
    const timer = window.setInterval(push, 4000);
    window.addEventListener("focus", push);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", push);
    };
  }, [user, route]);

  return null;
}
