import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarProvider } from "@/components/ui/sidebar";

import { BrainAvatar } from "../components/brain-avatar";
import { ZekraMark } from "../components/zekra-mark";
import { NoteEditor } from "../features/editor/note-editor";
import { ReadingTheme } from "../features/editor/reading-theme";
import { draftKey } from "../features/editor/tab-groups";
import { noteMenuAction, noteMenuItems } from "../features/notes/note-menu";
import { notesApi } from "../features/notes/notes-api";
import { useNoteActions } from "../features/notes/use-note-actions";
import type { Brain, Note } from "../lib/api";
import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { showMenu } from "../lib/native-menu";
import { usePlatform } from "../lib/platform";
import { pushRecentNote } from "../lib/recent";
import { useCommand } from "../shell/commands";
import { useSession } from "../shell/session";
import { StatusBar } from "../shell/status-bar";
import { useWindowControls, useWindowState } from "../shell/toolbar";

/*
A note in its own document window — src/main/native-ui.ts:

  ?window=note&ns=…&id=…    an existing note (Note ▸ Open in New Window ⌥⌘O,
                            the tray's Recent Notes); restored on relaunch
  ?window=note-new[&ns=…]   File ▸ New Note ⌘N, the toolbar pen, the tray,
                            the Dock, Spotlight: a NEW note. The title bar
                            carries a brain picker (the active brain first);
                            the first save creates the note there, the picker
                            locks, and main re-registers the window as that
                            note's (noteWindowCreated) so it is restored too.

Distraction-free: the window's title bar carries the note title and brain,
the editor's "…" menu; no sidebar, no list. Everything the editor does in the
main window works here (autosave, find, export, the Note menu); ⌘W closes the
window. Every save is announced to the other windows ("note-saved"), so the
main window's list follows live. The OS window title is the note's title.
*/
export function NoteWindow({ ns: initialNs, id: initialId }: { ns: string | null; id: string | null }) {
  const { t } = useI18n();
  const { token, user, brains } = useSession();
  const { platform } = usePlatform();
  const controls = useWindowControls();
  const win = useWindowState();
  const [note, setNote] = useState<Note | null>(null);
  const [failed, setFailed] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const isNew = initialId === null;
  // A new note: its tab has no id until the first save created it.
  const [tab, setTab] = useState(() => ({ key: initialId ?? draftKey(), id: initialId, title: "" }));
  const writable = useMemo(() => (brains ?? []).filter((b) => b.canWrite), [brains]);
  const [pickedNs, setPickedNs] = useState<string | null>(initialNs);
  const ns = note?.namespace || (isNew ? pickedNs : initialNs) || "";
  const brain = brains?.find((b) => b.namespace === ns) ?? null;

  // New note: default to the requested brain if writable, else the first one.
  useEffect(() => {
    if (!isNew || !brains || tab.id) return;
    if (!pickedNs || !writable.some((b) => b.namespace === pickedNs)) setPickedNs(writable[0]?.namespace ?? null);
  }, [isNew, brains, writable, pickedNs, tab.id]);

  useEffect(() => {
    if (!token || !initialId) return;
    let alive = true;
    notesApi
      .get(token, initialId)
      .then((n) => alive && setNote(n))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [token, initialId]);

  useEffect(() => {
    document.title = note?.title || (isNew && !tab.id ? t("win.newNote.title") : t("notes.x.untitled"));
  }, [note?.title, isNew, tab.id, t]);

  const saved = (n: Note) => {
    setNote(n);
    setTab((x) => ({ ...x, title: n.title }));
    void bridge().broadcast?.({ kind: "note-saved", note: n as unknown as { id: string } & Record<string, unknown> });
  };

  const actions = useNoteActions({
    token: token ?? "",
    brain: brain ?? { namespace: ns, role: "", canWrite: false, memories: 0 },
    latest: (n) => (note && note.version >= n.version ? note : n),
    onChanged: (n) => saved(n),
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

  const lights = platform === "darwin" && controls.side === "left" ? controls.inset : 0;
  const captions = platform === "win32" && controls.side === "right" ? controls.inset : 0;
  const picking = isNew && !tab.id;

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
          {picking ? (
            <>
              <span className="window-title-main shrink-0">{t("win.newNote.title")}</span>
              <BrainPicker brains={writable} value={pickedNs} onChange={setPickedNs} token={token} />
            </>
          ) : (
            <span className="grid min-w-0 leading-tight">
              <span className="window-title-main truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                {note?.title || tab.title || t("notes.x.untitled")}
              </span>
              <span className="window-title-sub truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                {brain?.displayName || ns}
              </span>
            </span>
          )}
          <div className="flex-1" />
          <div ref={setHost} className="flex items-center gap-1" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        {!user || !token ? (
          <p className="m-auto text-ui text-muted-foreground">{t("shell.signedOut")}</p>
        ) : failed ? (
          <p className="m-auto text-ui text-destructive">{t("ws.loadFailed")}</p>
        ) : picking && brains && !writable.length ? (
          <p className="m-auto px-6 text-center text-ui text-muted-foreground">{t("win.newNote.noBrains")}</p>
        ) : (!isNew && !note) || !brain ? (
          <Loader2 aria-label={t("ws.loading")} className="m-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          <NoteEditor
            key={tab.key}
            tab={tab}
            brain={brain}
            token={token}
            cached={note}
            focused
            outlineHost={null}
            chromeHost={host}
            onSaved={(_k, n) => saved(n)}
            onCreated={(_k, n) => {
              // The note exists now: this window is its window from here on.
              setTab((x) => ({ ...x, id: n.id, title: n.title }));
              saved(n);
              pushRecentNote({ id: n.id, namespace: brain.namespace, title: n.title, category: n.category });
              void bridge().noteWindowCreated?.({ namespace: brain.namespace, id: n.id, title: n.title });
            }}
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

/** The New Note window's brain picker (writable brains only). */
function BrainPicker({ brains, value, onChange, token }: {
  brains: Brain[];
  value: string | null;
  onChange: (ns: string) => void;
  token: string | null;
}) {
  const { t } = useI18n();
  if (!brains.length) return null;
  const byNs = new Map(brains.map((b) => [b.namespace, b]));
  return (
    <Select value={value ?? ""} onValueChange={(v) => v && onChange(String(v))}>
      <SelectTrigger className="field h-7 min-w-0 max-w-64 gap-2 border-0 text-[13px]" aria-label={t("win.newNote.brain")}>
        <SelectValue>
          {(ns: string) => {
            const b = byNs.get(ns);
            return b ? (
              <span className="flex min-w-0 items-center gap-2">
                <BrainAvatar brain={b} token={token} size={16} />
                <span className="truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                  {b.displayName || b.namespace}
                </span>
              </span>
            ) : (
              t("win.newNote.brain")
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {brains.map((b) => (
          <SelectItem key={b.namespace} value={b.namespace}>
            <span className="flex min-w-0 items-center gap-2">
              <BrainAvatar brain={b} token={token} size={16} />
              <span className="truncate" dir="auto" style={{ unicodeBidi: "plaintext" }}>
                {b.displayName || b.namespace}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
