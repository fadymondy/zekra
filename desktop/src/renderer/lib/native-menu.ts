import type { MouseEvent as ReactMouseEvent } from "react";

import type { NativeMenuItem } from "../../shared/ipc";
import { bridge } from "./bridge";

export type { NativeMenuItem };

/*
Native popup menus (src/main/native-ui.ts): every right-click and "…" menu in
the app is a real OS menu — AppKit on macOS, Win32 on Windows, GTK on Linux —
built from a plain item list. Resolves with the chosen item's id, or null.

    const id = await showMenu([{ id: "pin", label: t("notes.x.pin") }, SEP, …], e);

`at` is a mouse event (the menu opens under the pointer) or an element (the
menu drops from its bottom edge, like a toolbar pull-down). The browser
preview has no native menus and resolves null.
*/

export const SEP: NativeMenuItem = { type: "separator" };

export async function showMenu(items: NativeMenuItem[], at?: ReactMouseEvent | MouseEvent | Element | null): Promise<string | null> {
  const show = bridge().showContextMenu;
  if (!show) return null;
  let x: number | undefined;
  let y: number | undefined;
  if (at && "getBoundingClientRect" in at) {
    const r = at.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  } else if (at && "clientX" in at) {
    x = at.clientX;
    y = at.clientY;
  }
  // Keep the only strings that can reach the OS menu short and clean.
  const clean = (list: NativeMenuItem[]): NativeMenuItem[] =>
    list
      .filter((it, i, arr) => !(it.type === "separator" && (i === 0 || i === arr.length - 1 || arr[i - 1].type === "separator")))
      .map((it) => (it.submenu ? { ...it, submenu: clean(it.submenu) } : it));
  try {
    return await show({ items: clean(items), x, y });
  } catch {
    return null;
  }
}

/** onContextMenu handler factory: prevents the web menu and pops `items()`. */
export function contextMenu(items: () => NativeMenuItem[], onPick: (id: string) => void) {
  return (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void showMenu(items(), e).then((id) => id && onPick(id));
  };
}
