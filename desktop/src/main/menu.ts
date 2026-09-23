// The native application menu (Mark It Down–grade structure), localised EN/AR.
//
// Every app-specific item emits a typed command on the command bus
// (renderer-events.ts sendCommand -> IPC.evCommand); the renderer decides what
// it means in context (src/renderer/shell/commands.tsx). The few items that are
// intrinsically native — Open Markdown…, Check for Updates…, the web links,
// roles — are handled here.
//
// Rebuilt by installMenu() whenever the locale changes.
"use strict";

import { app, Menu, shell, type MenuItemConstructorOptions } from "electron";

import type { CommandName } from "../shared/ipc";
import { s } from "./menu-strings";
import { openMarkdownDialog } from "./deep-links";
import { sendCommand } from "./renderer-events";
import { checkForUpdatesInteractive } from "./updater";

export const APP_NAME = "Zekra";
export const APP_NAME_AR = "ذكرة";

const WEBSITE = "https://zekra.dev";
const ISSUES = "https://github.com/fadymondy/zekra/issues/new";

function cmd(label: string, name: CommandName, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, click: () => sendCommand(name, "menu") };
}

export function buildMenu(): Menu {
  const t = s();
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;

  const appMenu: MenuItemConstructorOptions = {
    label: APP_NAME,
    submenu: [
      cmd(t.about, "about"),
      { label: t.checkUpdates, click: () => void checkForUpdatesInteractive() },
      { type: "separator" },
      cmd(t.settings, "settings", "CmdOrCtrl+,"),
      cmd(t.signOut, "sign-out"),
      { type: "separator" },
      { role: "services", label: t.services },
      { type: "separator" },
      { role: "hide", label: t.hide },
      { role: "hideOthers", label: t.hideOthers },
      { role: "unhide", label: t.showAll },
      { type: "separator" },
      { role: "quit", label: t.quit },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: t.file,
    submenu: [
      cmd(t.newNote, "new-note", "CmdOrCtrl+N"),
      cmd(t.newBrain, "new-brain", "Shift+CmdOrCtrl+N"),
      { type: "separator" },
      { label: t.openMarkdown, accelerator: "CmdOrCtrl+O", click: () => void openMarkdownDialog() },
      {
        label: t.importFrom,
        submenu: [
          cmd(t.importAppleNotes, "import:apple-notes"),
          cmd(t.importGoogleKeep, "import:google-keep"),
          cmd(t.importNotion, "import:notion"),
          { type: "separator" },
          cmd(t.importMarkdownFolder, "import:markdown-folder"),
        ],
      },
      {
        label: t.export,
        submenu: [
          cmd(t.exportMd, "export:md"),
          cmd(t.exportHtml, "export:html"),
          cmd(t.exportPdf, "export:pdf"),
          cmd(t.exportDocx, "export:docx"),
          cmd(t.exportPng, "export:png"),
          cmd(t.exportTxt, "export:txt"),
        ],
      },
      { type: "separator" },
      cmd(t.save, "save", "CmdOrCtrl+S"),
      { type: "separator" },
      cmd(t.closeTab, "close-tab", "CmdOrCtrl+W"),
      cmd(t.reopenTab, "reopen-tab", "Shift+CmdOrCtrl+T"),
      { role: "close", label: t.closeWindow, accelerator: "Shift+CmdOrCtrl+W" },
      ...(isMac ? [] : ([{ type: "separator" }, cmd(t.signOut, "sign-out"), { role: "quit", label: t.quit }] as MenuItemConstructorOptions[])),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: t.edit,
    submenu: [
      { role: "undo", label: t.undo },
      { role: "redo", label: t.redo },
      { type: "separator" },
      { role: "cut", label: t.cut },
      { role: "copy", label: t.copy },
      { role: "paste", label: t.paste },
      { role: "pasteAndMatchStyle", label: t.pasteAndMatch },
      { role: "delete", label: t.delete },
      { role: "selectAll", label: t.selectAll },
      { type: "separator" },
      cmd(t.find, "find", "CmdOrCtrl+F"),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: t.view,
    submenu: [
      cmd(t.toggleSidebar, "toggle-sidebar", "CmdOrCtrl+\\"),
      cmd(t.toggleOutline, "toggle-outline", "Shift+CmdOrCtrl+L"),
      cmd(t.commandPalette, "spotlight", "CmdOrCtrl+K"),
      { type: "separator" },
      cmd(t.nextTab, "next-tab", "Alt+CmdOrCtrl+Right"),
      cmd(t.prevTab, "prev-tab", "Alt+CmdOrCtrl+Left"),
      { type: "separator" },
      { role: "resetZoom", label: t.actualSize },
      { role: "zoomIn", label: t.zoomIn },
      { role: "zoomOut", label: t.zoomOut },
      { type: "separator" },
      { role: "togglefullscreen", label: t.fullscreen },
      ...(isDev
        ? ([
            { type: "separator" },
            { role: "reload", label: t.reload },
            { role: "toggleDevTools", label: t.devtools },
          ] as MenuItemConstructorOptions[])
        : []),
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: t.window,
    role: "window",
    submenu: [
      { role: "minimize", label: t.minimize },
      { role: "zoom", label: t.zoom },
      ...(isMac ? ([{ type: "separator" }, { role: "front", label: t.front }] as MenuItemConstructorOptions[]) : []),
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: t.help,
    role: "help",
    submenu: [
      { label: t.website, click: () => void shell.openExternal(WEBSITE) },
      { label: t.reportIssue, click: () => void shell.openExternal(ISSUES) },
      { type: "separator" },
      { label: t.checkUpdates, click: () => void checkForUpdatesInteractive() },
    ],
  };

  return Menu.buildFromTemplate(
    isMac ? [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu] : [fileMenu, editMenu, viewMenu, windowMenu, helpMenu],
  );
}

export function installMenu(): void {
  Menu.setApplicationMenu(buildMenu());
}
