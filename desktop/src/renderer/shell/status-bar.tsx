import { Slot, useSlotFilled } from "./slots";

/*
The status line: a quiet 24px strip at the foot of the content pane that
exists only while a screen has something to say — word count, cursor, save
state (the note editor publishes them with useSlot("statusbar.end", …)).
Connection state lives in the sidebar footer (shell/app-sidebar.tsx), so an
idle window has no status bar at all, like Notes or Linear.
*/

export const STATUSBAR_HEIGHT = 24;

export function StatusBar() {
  const filled = useSlotFilled("statusbar.start", "statusbar.end");
  if (!filled) return null;
  return (
    <footer
      className="app-chrome flex shrink-0 items-center gap-3 border-t border-border/50 bg-background px-3 text-[11px] text-muted-foreground"
      style={{ height: STATUSBAR_HEIGHT }}
    >
      <Slot name="statusbar.start" />
      <div className="ms-auto flex items-center gap-3">
        <Slot name="statusbar.end" />
      </div>
    </footer>
  );
}
