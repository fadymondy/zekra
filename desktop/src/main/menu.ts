// Native app menu: Zekra / Edit / View / Window / Help. Mirrors the shape of
// mark-it-down's apps/electron menu (app menu first on all platforms, folded
// About/Quit into it on win/linux since there's no separate File menu here
// either) but with Zekra's own actions (New note, Settings) instead of file IO.
"use strict";

import { BrowserWindow, Menu, MenuItemConstructorOptions, shell } from "electron";

const APP_NAME = "Zekra";
const APP_NAME_AR = "ذكرة";

function send(channel: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send(channel);
}

export function buildMenu(): Menu {
  const isMac = process.platform === "darwin";

  const appMenu: MenuItemConstructorOptions = {
    label: APP_NAME,
    submenu: [
      {
        label: `About ${APP_NAME}`,
        click: () => send("zekra:menu:about"),
      },
      { type: "separator" },
      {
        label: "Settings…",
        accelerator: "CmdOrCtrl+,",
        click: () => send("zekra:menu:settings"),
      },
      { type: "separator" },
      ...(isMac
        ? ([
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
          ] as MenuItemConstructorOptions[])
        : []),
      { role: "quit", label: `Quit ${APP_NAME}` },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "Note",
    submenu: [
      { label: "New Note", accelerator: "CmdOrCtrl+N", click: () => send("zekra:menu:new-note") },
      { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("zekra:menu:save-note") },
      { type: "separator" },
      { label: "Sign Out", click: () => send("zekra:menu:sign-out") },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "close" },
      ...(isMac
        ? ([{ type: "separator" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      {
        label: `${APP_NAME} (${APP_NAME_AR}) on the web`,
        click: async () => {
          await shell.openExternal("https://zekra.dev");
        },
      },
      {
        label: "Version",
        enabled: false,
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
  const menu = Menu.buildFromTemplate(template);
  return menu;
}

export function installMenu(): void {
  Menu.setApplicationMenu(buildMenu());
}

export { APP_NAME, APP_NAME_AR };
