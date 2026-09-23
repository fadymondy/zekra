import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { SidebarProvider } from "@/components/ui/sidebar";

import { ZekraMark } from "../components/zekra-mark";
import { loadMode, saveMode, type EditorMode } from "../features/editor/editor-chrome";
import { NoteEditor } from "../features/editor/note-editor";
import { ReadingTheme } from "../features/editor/reading-theme";
import { noteMenuAction, noteMenuItems } from "../features/notes/note-menu";
import { notesApi } from "../features/notes/notes-api";
import { useNoteActions } from "../features/notes/use-note-actions";
import type { Note } from "../lib/api";
import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { showMenu } from "../lib/native-menu";
import { usePlatform } from "../lib/platform";
import { useCommand } from "../shell/commands";
import { useSession } from "../shell/session";
import { StatusBar } from "../shell/status-bar";
import { useWindowControls, useWindowState } from "../shell/toolbar";

/*
A note in its own document window (Note ▸ Open in New Window, ⌥⌘O, or a
double-click in the list) — src/main/native-ui.ts opens index.html
?window=note&ns=…&id=… and restores these windows on relaunch.

Distraction-free: the window's title bar carries the note title and brain,
the editor's mode switch and "…" menu; no sidebar, no list. Everything the
editor does in the main window works here (autosave, find, export, the Note
menu); ⌘W closes the window. The OS window title is the note's title, so the
Window menu (macOS) / taskbar (Windows) lists it.
*/
export function NoteWindow({ ns, id }: { ns: string; id: string }) {
  const { t, isRtl } = useI18n();
  const { token, user, brains } = useSession();
  const { platform } = usePlatform();
  const controls = useWindowControls();
  const win = useWindowState();
  const [note, setNote] = useState<Note | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setModeState] = useState<EditorMode>(loadMode);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const brain = brains?.find((b) => b.namespace === ns) ?? null;

  useEffect(() => {
    if (!token) return;
    let alive = true;
    notesApi
      .get(token, id)
      .then((n) => alive && setNote(n))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [token, id]);

  useEffect(() => {
    document.title = note?.title || t("notes.x.untitled");
  }, [note?.title, t]);

  const setMode = useCallback((m: EditorMode) => {
    setModeState(m);
    saveMode(m);
  }, []);

  const actions = useNoteActions({
    token: token ?? "",
    brain: brain ?? { namespace: ns, role: "", canWrite: false, memories: 0 },
    latest: (n) => (note && note.version >= n.version ? note : n),
    onChanged: (n) => setNote(n),
    onRemoved: () => void bridge().closeWindow(),
    onOpen: () => undefined,
  });

  useCommand("close-tab", () => void bridge().closeWindow());
  const run = (kind: "pin" | "archive" | "appearance-picker" | "versions" | "copy" | "delete") => () => {
    if (note) actions.run(note, { kind });
  };
  useCommand("note:pin", run("pin"));
  useCommand("note:archive", run("archive"));
  useCommand("note:appearance", run("appearance-picker"));
  useCommand("note:versions", run("versions"));
  useCommand("note:copy", run("copy"));
  useCommand("note:delete", run("delete"));
  useCommand("open-in-new-window", () => undefined);

  const tab = useMemo(() => ({ key: id, id, title: note?.title ?? "" }), [id, note?.title]);

  const lights = platform === "darwin" && controls.side === "left" ? controls.inset : 0;
  const captions = platform === "win32" && controls.side === "right" ? controls.inset : 0;

  return (
    // The editor portals into toolbar hosts that use the sidebar context.
    <SidebarProvider open={false} keyboardShortcut={false} className="h-full min-h-0 flex-col">
      <ReadingTheme />
      <header
        className="toolbar app-drag app-chrome relative flex shrink-0 items-center gap-2 px-3"
        style={{ height: "var(--titlebar-h)", paddingLeft: lights || undefined, paddingRight: captions || undefined }}
      >
        <div className={win.focused ? "flex min-w-0 flex-1 items-center gap-2" : "flex min-w-0 flex-1 items-center gap-2 opacity-60"}>
          {platform === "win32" ? <ZekraMark size={16} className="shrink-0" /> : null}
          <span className="grid min-w-0 leading-tight" style={isRtl ? undefined : undefined}>
            <span className="window-title-main truncate" style={{ unicodeBidi: "plaintext" }}>
              {note?.title || t("notes.x.untitled")}
            </span>
            <span className="window-title-sub truncate" style={{ unicodeBidi: "plaintext" }}>
              {brain?.displayName || ns}
            </span>
          </span>
          <div className="flex-1" />
          <div ref={setHost} className="flex items-center gap-1" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {!user || !token ? (
          <p className="m-auto text-ui text-muted-foreground">{t("shell.signedOut")}</p>
        ) : failed ? (
          <p className="m-auto text-ui text-destructive">{t("ws.loadFailed")}</p>
        ) : !note || !brain ? (
          <Loader2 aria-label={t("ws.loading")} className="m-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          <NoteEditor
            tab={tab}
            brain={brain}
            token={token}
            cached={note}
            focused
            mode={mode}
            onModeChange={setMode}
            outlineHost={null}
            chromeHost={host}
            onSaved={(_k, n) => setNote(n)}
            onCreated={(_k, n) => setNote(n)}
            onStatus={() => undefined}
            onMenu={(n, anchor) =>
              void showMenu(noteMenuItems(n, t, { canWrite: brain.canWrite, showOpen: false, canOpenWindow: false }), anchor).then((mid) => {
                const a = mid ? noteMenuAction(mid) : null;
                if (a) actions.run(n, a);
              })
            }
          />
        )}
      </div>
      <StatusBar />
      {actions.dialogs}
    </SidebarProvider>
  );
}
