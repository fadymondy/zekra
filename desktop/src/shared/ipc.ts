// The ONE contract between the main process, the preload bridge and the
// renderer. Everything that crosses IPC is declared here, so a channel name or
// a payload shape cannot drift between the three sides.
//
// Rules for this file:
//   - Types and plain `const` data only. It is compiled by tsc for the main
//     process AND bundled by esbuild into the preload and the renderer, so it
//     must not import electron, node or react.
//   - Adding an IPC call = add a channel to `IPC`, add the method to
//     `ZekraBridge`, implement it in src/main/ipc.ts, expose it in
//     src/main/preload.ts, and (if it makes sense) fake it in the browser
//     preview bridge (src/renderer/lib/bridge.ts).

/* ------------------------------------------------------------ settings */

/** The app's own theme choice. `system` follows macOS; the others force it
 *  (main sets `nativeTheme.themeSource`, so native menus, dialogs, the
 *  vibrancy and `prefers-color-scheme` in the renderer all agree). */
export type ThemeChoice = "system" | "light" | "dark";
export type LocaleId = "en" | "ar";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
  roles?: string[];
}

export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
  fullscreen?: boolean;
}

/** App lock (Touch ID). Owned by src/renderer/features/security. */
export interface LockSettings {
  enabled: boolean;
  /** Use Touch ID where the Mac has it. */
  touchId: boolean;
  /** Lock after this many minutes in the background; 0 = on every hide.
   *  The UI offers 0 / 1 / 5 / 15. */
  timeoutMinutes: number;
  /** MH-450 security: the one-time "Lock Zekra with Touch ID?" offer after a
   *  sign-in was answered (either way). Optional so older stores still parse. */
  offered?: boolean;
}

/**
 * Local, device-only settings (src/main/settings-store.ts). Nothing here is
 * sent to the backend. `authToken` is stored ENCRYPTED on disk with Electron
 * safeStorage (Keychain-backed on macOS); the decrypted value is what crosses
 * IPC.
 */
export interface AppSettings {
  /** Zekra API origin, e.g. https://app.zekra.dev (no trailing slash). */
  apiBaseUrl: string;
  theme: ThemeChoice;
  locale: LocaleId;
  /** Namespace of the brain last opened; restores the brain route on boot. */
  activeBrain: string | null;
  authToken: string | null;
  authUser: SessionUser | null;
  /** Main-window geometry, persisted by the main process. Read-only from the
   *  renderer's point of view (patching it is ignored). */
  windowBounds: WindowBounds | null;
  lock: LockSettings;
  /* Desktop services (src/main/services.ts). */
  /** Global Quick Capture accelerator. null = the platform default
   *  (macOS Alt+Command+N, elsewhere Control+Alt+N); "" = disabled. */
  quickCaptureShortcut: string | null;
  /** The brain Quick Capture saved to last. */
  quickCaptureBrain: string | null;
  /** Start Zekra when the user logs in (macOS/Windows login item, Linux XDG autostart). */
  launchAtLogin: boolean;
  /** …without opening the window: menubar / tray only. */
  openAtLoginHidden: boolean;
  /** Background sync period; 0 = only on launch, focus and after edits. */
  syncIntervalMinutes: number;
  /** Keep a local copy of brains and notes so the app opens instantly and works offline. */
  offlineCacheEnabled: boolean;
  /* Updates (src/main/updater.ts). */
  /** Install a downloaded update by itself: while the Mac is idle (no unsaved
   *  edits) and on quit. Off = only when the user clicks Restart to Update
   *  (critical releases still install on quit). */
  autoInstallUpdates: boolean;
  /** stable = full GitHub releases only; beta = pre-releases too. */
  updateChannel: UpdateChannel;
  /** Global shortcut for the Spotlight window (works while another app is in
   *  front). "" = off (⌘K / Ctrl+K inside Zekra always works). Set through
   *  setSpotlightShortcut, which validates and registers it. */
  spotlightShortcut?: string;
}

/** Keys the renderer may patch. windowBounds is owned by main. */
export type SettingsPatch = Partial<Omit<AppSettings, "windowBounds">>;

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: "https://app.zekra.dev",
  theme: "dark",
  locale: "en",
  activeBrain: null,
  authToken: null,
  authUser: null,
  windowBounds: null,
  lock: { enabled: false, touchId: true, timeoutMinutes: 5, offered: false },
  quickCaptureShortcut: null,
  quickCaptureBrain: null,
  launchAtLogin: false,
  openAtLoginHidden: true,
  syncIntervalMinutes: 5,
  offlineCacheEnabled: true,
  autoInstallUpdates: true,
  updateChannel: "stable",
};

/* ------------------------------------------------------------ commands */

/**
 * Every command the native menu, the tray or the renderer itself can issue.
 * Main sends them on `IPC.command`; the renderer's command registry
 * (src/renderer/shell/commands.tsx) dispatches them to whichever handler is
 * registered — see `useCommand`.
 */
export const COMMANDS = [
  // File
  "new-note",
  "new-brain",
  "save",
  "close-tab",
  "reopen-tab",
  "import:apple-notes",
  "import:google-keep",
  "import:notion",
  "import:markdown-folder",
  "export:md",
  "export:html",
  "export:pdf",
  "export:docx",
  "export:png",
  "export:txt",
  // Edit
  "find",
  // View
  "toggle-sidebar",
  "toggle-outline",
  "spotlight",
  "next-tab",
  "prev-tab",
  // App
  "settings",
  "sign-out",
  "about",
  // Help ▸ Check for Updates… / the tray: open the Software Update sheet.
  "update:show",
  // Native-shell navigation & object menus (Note / Brain / Go, context menus)
  "toggle-list",
  "open-in-new-window",
  "note:pin",
  "note:archive",
  "note:appearance",
  "note:versions",
  "note:rename",
  "note:view-source",
  "note:copy",
  "note:delete",
  "brain:notes",
  "brain:presentations",
  "brain:vault",
  "brain:export",
  "go:back",
  "go:brains",
  "go:search",
  "go:inbox",
] as const;

export type CommandName = (typeof COMMANDS)[number];

export type ExportFormat = "md" | "html" | "pdf" | "docx" | "png" | "txt";
export type ImportSource = "apple-notes" | "google-keep" | "notion" | "markdown-folder";

export interface CommandEvent {
  name: CommandName;
  /** Where it came from — handy for analytics / focus decisions. */
  source: "menu" | "tray" | "renderer";
}

/* -------------------------------------------------------------- events */

/** A `zekra://…` URL the OS handed to the app (open-url on macOS, argv on
 *  Windows/Linux). The social sign-in flows come back as
 *  zekra://auth/github?code=… and zekra://auth/google?code=…. */
export interface DeepLinkEvent {
  url: string;
  /** First path segment after the scheme, e.g. "auth". */
  host: string;
  /** The rest, without leading slash, e.g. "github". */
  path: string;
  params: Record<string, string>;
}

/** A markdown file opened from Finder / Dock / "Open Markdown…" / argv. The
 *  main process has already read it (UTF-8). */
export interface OpenFileEvent {
  path: string;
  name: string;
  content: string;
  /** Why it arrived — `dialog` = File ▸ Open Markdown…. */
  origin: "finder" | "dialog" | "argv";
}

export interface NotificationClickEvent {
  /** The route string passed to `notify()`; the renderer decides what it means. */
  route?: string;
}

export interface WindowStateEvent {
  focused: boolean;
  fullscreen: boolean;
  maximized: boolean;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error"
  | "disabled";

export type UpdateChannel = "stable" | "beta";

/** The updater's state (src/main/updater.ts), broadcast on every change. */
export interface UpdateState {
  status: UpdateStatus;
  /** The version on offer (available … installing). */
  version?: string;
  /** 0–100 while downloading. */
  progress?: number;
  /** Download speed and size while downloading (bytes, bytes/s). */
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  /** Release notes of the version on offer: GitHub gives HTML, a hand-written
   *  feed may give markdown — both render through the markdown pipeline. */
  releaseNotes?: string;
  releaseName?: string;
  releaseDate?: string;
  /** The release is marked `[critical]` (notes or title): the prompt cannot be
   *  snoozed for long and it always installs on quit. */
  critical?: boolean;
  /** Downloaded and the update policy wants the user asked now (not snoozed,
   *  not about to install by itself). */
  prompt?: boolean;
  message?: string;
  /** Always present: the running version, channel and auto-install setting. */
  currentVersion?: string;
  channel?: UpdateChannel;
  autoInstall?: boolean;
  /** When the last check finished (ms since epoch). */
  checkedAt?: number;
}

/** MH-450 app lock (src/main/app-activity.ts):
 *  background  the app resigned active, was hidden, or its window minimised
 *  active      it came back
 *  system-lock the Mac locked its screen or went to sleep */
export interface AppActivityEvent {
  state: "background" | "active" | "system-lock";
}

/** Placeholder for the MCP-connection status shown in the tray menu. */
export interface TrayStatus {
  mcp: "connected" | "disconnected" | "unknown";
  label?: string;
}

/* -------------------------------------------------------------- proxy */

/** A backend call performed by the main process (src/main/api-proxy.ts). */
export interface ProxyRequest {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  /** JSON (or any text) body. */
  body?: string;
  /** A multipart upload. Mutually exclusive with `body`. */
  file?: { field: string; filename: string; contentType: string; bytes: Uint8Array; fields: Record<string, string> };
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** An authenticated binary GET (images). The main process attaches the stored
 *  bearer token itself, so the renderer never needs to. */
export interface BinaryResponse {
  ok: boolean;
  status: number;
  contentType: string;
  bytes: Uint8Array | null;
}

/* ------------------------------------------------------------ dialogs */

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface SaveFileRequest {
  /** Suggested file name, e.g. "Meeting notes.pdf". */
  suggestedName: string;
  filters?: FileFilter[];
  /** Text content (written as UTF-8) … */
  text?: string;
  /** … or raw bytes. Exactly one of text / bytes / base64. */
  bytes?: Uint8Array;
  base64?: string;
  title?: string;
}

export interface SaveFileResult {
  canceled: boolean;
  path?: string;
}

export interface OpenFileRequest {
  title?: string;
  filters?: FileFilter[];
  multiple?: boolean;
  directory?: boolean;
  /** Read the picked files and return their content in this encoding. */
  read?: "utf8" | "base64";
}

export interface PickedFile {
  path: string;
  name: string;
  /** Present when `read` was requested and the pick was a file. */
  content?: string;
}

export interface OpenFileResult {
  canceled: boolean;
  files: PickedFile[];
}

export interface ConfirmRequest {
  message: string;
  detail?: string;
  /** Button labels, in order. Default: [OK, Cancel] localised by the caller. */
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  type?: "none" | "info" | "error" | "question" | "warning";
}

export interface PdfRequest {
  /** A self-contained HTML document (inline CSS, data: images). */
  html: string;
  pageSize?: "A4" | "Letter" | "Legal" | "A3" | "A5";
  landscape?: boolean;
  printBackground?: boolean;
  /** Inches. Default 0.5 all round. */
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
}

export interface NotifyRequest {
  title: string;
  body?: string;
  /** Opaque route handed back on click via onNotificationClick. */
  route?: string;
  silent?: boolean;
}

export interface AppInfo {
  version: string;
  platform: "darwin" | "win32" | "linux" | "browser";
  arch: string;
  isPackaged: boolean;
  /** Width in CSS px the title bar must leave for the window controls, and
   *  on which PHYSICAL side they sit (macOS traffic lights are always left,
   *  whatever the app's locale). */
  windowControls: { side: "left" | "right"; inset: number };
  /** OS release (macOS/Darwin, Windows build "10.0.22631", Linux kernel). */
  osVersion?: string;
  /** How the window is framed (src/main/window-chrome.ts):
   *  hidden-inset  macOS: traffic lights over the renderer's unified toolbar
   *  overlay       Windows: native caption buttons over the renderer's title bar
   *  frame         Linux: the window manager's own frame */
  chrome?: "hidden-inset" | "overlay" | "frame";
  /** Height of the renderer-drawn title bar / toolbar row, CSS px. */
  titleBarHeight?: number;
  /** A translucent system material sits behind the window (vibrancy / Mica). */
  material?: "vibrancy" | "mica" | "none";
}

/* Native shell (src/main/native-ui.ts). */

/** One item of a native popup menu (Menu.buildFromTemplate().popup()). */
export interface NativeMenuItem {
  /** Returned by showContextMenu when this item is chosen. */
  id?: string;
  label?: string;
  type?: "normal" | "separator" | "checkbox" | "radio" | "submenu";
  checked?: boolean;
  enabled?: boolean;
  /** Display-only shortcut hint, e.g. "CmdOrCtrl+Backspace". */
  accelerator?: string;
  submenu?: NativeMenuItem[];
}

export interface PopupMenuRequest {
  items: NativeMenuItem[];
  /** Window-relative CSS px; defaults to the mouse position. */
  x?: number;
  y?: number;
}

/** A note opened in its own document window. */
export interface NoteWindowRequest {
  namespace: string;
  id: string;
  title?: string;
}

/* App windows (src/main/app-windows.ts) — every surface is the same bundled
 * index.html, picked by `?window=`:
 *   main       the app
 *   note       a note document window (native-ui.ts)
 *   note-new   a new, not yet saved note (brain picker on top); becomes a
 *              `note` window once its first save created it
 *   settings   the Settings window (single instance, remembers its frame)
 *   spotlight  the search / command panel (frameless, vibrancy / acrylic)
 *   new-brain  the New Brain window */
export type AppWindowKind = "main" | "note" | "note-new" | "settings" | "spotlight" | "new-brain";

/** Settings window sections (zekra://settings/<section>). */
export const SETTINGS_SECTIONS = ["general", "reading", "notifications", "security", "services", "account", "connect", "about"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number];

/** Renderer-to-renderer messages, relayed by main to every OTHER window. */
export type AppBroadcast =
  /** The note reading/typography store changed (web lib/notes/note-settings). */
  | { kind: "reading-settings"; settings: unknown }
  /** A note was created or saved in another window (a Note, loosely typed). */
  | { kind: "note-saved"; note: { id: string; namespace?: string } & Record<string, unknown> }
  /** Brains were created / changed; `open` = show this one in the main window. */
  | { kind: "brains-changed"; open?: string };

/** What the menubar menu shows that only the main window's renderer knows. */
export interface TrayState {
  /** Unread notifications; null = unknown / no notification center. */
  unread: number | null;
  brains: { namespace: string; name: string }[];
}

/** Title-bar colours the renderer resolves from the theme tokens (Windows'
 *  caption-button overlay cannot read CSS). */
export interface WindowChromeColors {
  background: string;
  foreground: string;
}

/* MH-450 Settings ▸ Connect: write a Zekra remote-MCP entry into an AI tool's
 * config (~/.claude.json or ~/.cursor/mcp.json). Main confirms natively and
 * backs the file up first (src/main/mcp-install.ts). */
export type McpTarget = "claude" | "cursor";
export interface McpInstallResult {
  status: "installed" | "cancelled" | "error";
  /** The config file written. */
  path?: string;
  /** Where the previous file was copied, when there was one. */
  backup?: string;
  message?: string;
}
/** Whether each tool's config already has a `zekra` mcpServers entry. */
export type McpInstallStatus = Record<McpTarget, boolean>;

/* MH-450 Mark It Down features — importers, opened documents, tray recents
 * (src/main/importers/*, src/main/tray.ts; renderer features/{import,
 * open-file,markdown-extras}). Main parses the sources (the sandboxed renderer
 * cannot read files); the renderer pulls drafts in batches and creates the
 * notes through the API. */
export interface ImportScanRequest {
  /** Chosen by the renderer, so it can cancel while the scan runs. */
  id: string;
  source: ImportSource;
}
export type ImportErrorCode = "permission" | "unsupported" | "not-found" | "empty" | "failed" | "timeout";
export interface ImportScanResult {
  id: string;
  status: "ok" | "canceled" | "error";
  error?: string;
  errorCode?: ImportErrorCode;
  /** The picked folder/zip name ("Apple Notes" for the live source). */
  sourceLabel?: string;
  /** Notes ready to import. */
  total: number;
  /** Not imported, by reason: locked, trashed, deleted, empty, too-large, unreadable. */
  skipped: Record<string, number>;
  /** The first few titles, for the preview. */
  sample: string[];
  /** Images that will be uploaded with the notes. */
  images: number;
  warnings: string[];
}
/** An image referenced in a draft body as `zekra-attachment:<ref>`. */
export interface ImportAttachment {
  ref: string;
  name: string;
  mime: string;
  /** null when the file could not be read. */
  bytes: Uint8Array | null;
}
export interface ImportDraft {
  title: string;
  body: string;
  tags: string[];
  pinned?: boolean;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Source path / folder, for the failure report. */
  origin?: string;
  attachments: ImportAttachment[];
}
export interface ImportBatch {
  drafts: ImportDraft[];
  done: boolean;
  remaining: number;
}
export interface ImportProgressEvent {
  id: string;
  done: number;
  total?: number;
  message?: string;
}
/** One of the "Recent Notes" in the menubar menu. */
export interface TrayRecentNote {
  id: string;
  namespace: string;
  title: string;
}

/* ------------------------------------------------------------- channels */

/** Wire names. Invoke channels use ipcMain.handle; event channels are sent
 *  main -> renderer with webContents.send. */
export const IPC = {
  // settings
  settingsGet: "zekra:settings:get",
  settingsPatch: "zekra:settings:patch",
  settingsClearSession: "zekra:settings:clear-session",
  // app
  appInfo: "zekra:app:info",
  appOpenExternal: "zekra:app:open-external",
  appRendererReady: "zekra:app:renderer-ready",
  appShowAbout: "zekra:app:show-about",
  // network
  apiRequest: "zekra:api:request",
  apiBinary: "zekra:api:binary",
  // native services
  dialogSave: "zekra:dialog:save",
  dialogOpen: "zekra:dialog:open",
  dialogConfirm: "zekra:dialog:confirm",
  printToPdf: "zekra:print:pdf",
  notify: "zekra:notify:show",
  touchIdCan: "zekra:touchid:can",
  touchIdPrompt: "zekra:touchid:prompt",
  clipboardWriteText: "zekra:clipboard:write-text",
  // MH-450 vault: write a secret and wipe it after a delay if still there.
  clipboardWriteSecret: "zekra:clipboard:write-secret",
  windowSetEdited: "zekra:window:set-edited",
  windowClose: "zekra:window:close",
  updateCheck: "zekra:update:check",
  updateGetState: "zekra:update:state",
  updateInstall: "zekra:update:install",
  updateSnooze: "zekra:update:snooze",
  traySetStatus: "zekra:tray:set-status",
  // MH-450 notifications (Dock badge) + Settings ▸ Connect (MCP install)
  appSetBadge: "zekra:app:set-badge",
  mcpInstall: "zekra:mcp:install",
  mcpStatus: "zekra:mcp:status",
  // MH-450 Mark It Down features: importers, reveal a file, tray recents
  importScan: "zekra:import:scan",
  importNext: "zekra:import:next",
  importCancel: "zekra:import:cancel",
  shellReveal: "zekra:shell:reveal",
  traySetRecent: "zekra:tray:set-recent",
  // Native shell: popup menus, the app menu as a title-bar button (Windows),
  // note windows, title-bar overlay colours (src/main/native-ui.ts)
  menuPopup: "zekra:menu:popup",
  menuPopupApp: "zekra:menu:popup-app",
  windowOpenNote: "zekra:window:open-note",
  windowSetChrome: "zekra:window:set-chrome",
  // App windows (src/main/app-windows.ts): Settings, Spotlight, New Brain,
  // New Note; the calling window hides / sizes itself; open a route in main.
  windowOpenSettings: "zekra:window:open-settings",
  windowOpenSpotlight: "zekra:window:open-spotlight",
  windowOpenNewBrain: "zekra:window:open-new-brain",
  windowOpenNewNote: "zekra:window:open-new-note",
  windowNoteCreated: "zekra:window:note-created",
  windowOpenInMain: "zekra:window:open-in-main",
  windowHideSelf: "zekra:window:hide-self",
  windowResizeSelf: "zekra:window:resize-self",
  windowSetSpotlightShortcut: "zekra:window:set-spotlight-shortcut",
  appBroadcast: "zekra:app:broadcast",
  traySetState: "zekra:tray:set-state",
  // events (main -> renderer)
  evSettingsChanged: "zekra:settings-changed",
  evBroadcast: "zekra:broadcast",
  evWindowShown: "zekra:window-shown",
  evSettingsSection: "zekra:settings-section",
  evCommand: "zekra:command",
  evDeepLink: "zekra:deep-link",
  evOpenFile: "zekra:open-file",
  evNotificationClick: "zekra:notification-click",
  evSystemTheme: "zekra:system-theme-changed",
  evWindowState: "zekra:window-state",
  evUpdateState: "zekra:update-state",
  // MH-450 app lock: the app went to the background / came back / the Mac locked.
  evAppActivity: "zekra:app-activity",
  // MH-450 importers: scan progress (main -> renderer).
  evImportProgress: "zekra:import-progress",
  // Desktop services (src/main/services.ts): offline cache + sync, Quick
  // Capture, login item, share, rich notifications.
  offlineNotes: "zekra:offline:notes",
  offlineNote: "zekra:offline:note",
  offlineBrains: "zekra:offline:brains",
  offlineVersions: "zekra:offline:versions",
  offlinePut: "zekra:offline:put",
  offlineEnqueue: "zekra:offline:enqueue",
  offlineResolveBase: "zekra:offline:resolve-base",
  offlineSyncNow: "zekra:offline:sync-now",
  offlineStatus: "zekra:offline:status",
  offlineClear: "zekra:offline:clear",
  offlineDismissConflict: "zekra:offline:dismiss-conflict",
  captureOpen: "zekra:capture:open",
  captureInit: "zekra:capture:init",
  captureSave: "zekra:capture:save",
  captureClose: "zekra:capture:close",
  captureClipboard: "zekra:capture:clipboard",
  captureBrowserTab: "zekra:capture:browser-tab",
  servicesInfo: "zekra:services:info",
  servicesSetShortcut: "zekra:services:set-shortcut",
  shareNote: "zekra:share:note",
  notifyRich: "zekra:notify:rich",
  evSyncStatus: "zekra:sync-status",
  evSyncChange: "zekra:sync-change",
  evNotificationAction: "zekra:notification-action",
  evCaptureShow: "zekra:capture-show",
} as const;

/* --------------------------------------------------------------- bridge */

type Unsubscribe = () => void;

/** `window.zekra` — the entire surface the renderer has onto the OS. */
export interface ZekraBridge {
  // settings / session
  getSettings(): Promise<AppSettings>;
  patchSettings(patch: SettingsPatch): Promise<AppSettings>;
  clearSession(): Promise<AppSettings>;

  // app
  getAppInfo(): Promise<AppInfo>;
  /** Kept for existing callers; same as getAppInfo().version. */
  getVersion(): Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Call once the renderer has subscribed to events. Main buffers deep
   *  links / opened files / notification clicks until then. */
  rendererReady(): Promise<void>;
  showAboutPanel(): Promise<void>;

  // network
  apiRequest(req: ProxyRequest): Promise<ProxyResponse>;
  /** Authed GET of a path on the API origin (or an absolute URL on it). */
  apiBinary(pathOrUrl: string): Promise<BinaryResponse>;

  // native services
  saveFile(req: SaveFileRequest): Promise<SaveFileResult>;
  openFile(req: OpenFileRequest): Promise<OpenFileResult>;
  confirm(req: ConfirmRequest): Promise<{ response: number }>;
  printToPdf(req: PdfRequest): Promise<Uint8Array>;
  notify(req: NotifyRequest): Promise<void>;
  canPromptTouchId(): Promise<boolean>;
  promptTouchId(reason: string): Promise<{ ok: boolean; error?: string }>;
  writeClipboardText(text: string): Promise<void>;
  /** MH-450 vault: write `text`, then clear the clipboard after `clearAfterMs`
   *  if it still holds exactly `text` (main-side timer; survives reloads). */
  writeSecretText(text: string, clearAfterMs: number): Promise<void>;
  /** macOS "edited" dot in the close button. */
  setDocumentEdited(edited: boolean): Promise<void>;
  closeWindow(): Promise<void>;
  checkForUpdates(): Promise<UpdateState>;
  getUpdateState(): Promise<UpdateState>;
  installUpdate(): Promise<boolean>;
  /** "Later": hide the ready prompt for a while (critical: a shorter while). */
  snoozeUpdate?(): Promise<UpdateState>;
  setTrayStatus(status: TrayStatus): Promise<void>;
  /** MH-450: unread count on the Dock icon; 0 clears it. */
  setBadgeCount(count: number): Promise<void>;
  /** MH-450: add Zekra's remote MCP server (`url`, https only) to a tool's
   *  config after a native confirm; the old file is backed up first. */
  installMcp(target: McpTarget, url: string): Promise<McpInstallResult>;
  getMcpStatus(): Promise<McpInstallStatus>;
  /* MH-450 Mark It Down features. Optional: desktop-only, absent from the
   * browser preview bridge (callers use `?.`). */
  /** Pick a source (native dialog; none for Apple Notes) and parse it. */
  importScan?(req: ImportScanRequest): Promise<ImportScanResult>;
  /** The next drafts of a scanned import, with their image bytes. */
  importNext?(id: string, max: number): Promise<ImportBatch>;
  /** Cancel a running scan and/or release a finished import. */
  importCancel?(id: string): Promise<void>;
  /** Reveal a file in Finder (an opened .md document). */
  revealInFinder?(path: string): Promise<void>;
  /** The menubar's "Recent Notes" (newest first, max 5). */
  setTrayRecent?(notes: TrayRecentNote[]): Promise<void>;
  /* Native shell. Optional: absent from the browser preview. */
  /** Pop a native menu; resolves with the chosen item's id, or null. */
  showContextMenu?(req: PopupMenuRequest): Promise<string | null>;
  /** Pop the application menu (Windows/Linux title-bar "…" button). */
  popupAppMenu?(x: number, y: number): Promise<void>;
  /** Open (or focus) a note in its own window. */
  openNoteWindow?(req: NoteWindowRequest): Promise<void>;
  /** Theme colours for native title-bar parts (Windows caption overlay). */
  setWindowChrome?(colors: WindowChromeColors): Promise<void>;
  /* App windows (src/main/app-windows.ts). Optional: absent from the preview. */
  /** Open (or focus) the Settings window, at `section`. */
  openSettingsWindow?(section?: SettingsSectionId): Promise<void>;
  /** Show the Spotlight panel. */
  openSpotlight?(): Promise<void>;
  openNewBrainWindow?(): Promise<void>;
  /** A new note in its own window; `namespace` preselects the brain. */
  openNewNoteWindow?(namespace?: string | null): Promise<void>;
  /** The calling note-new window's note now exists (restored as a note window). */
  noteWindowCreated?(req: NoteWindowRequest): Promise<void>;
  /** Focus (or open) the main window and go to a compact route
   *  (router routeFromString syntax; "notifications" opens the bell). */
  openInMain?(route: string): Promise<void>;
  /** Hide (Spotlight) or close the calling window. */
  hideSelf?(): Promise<void>;
  /** Spotlight sizes itself to its content (CSS px). */
  resizeSelf?(height: number): Promise<void>;
  /** Validate, register and persist the global Spotlight shortcut ("" = off). */
  setSpotlightShortcut?(accelerator: string): Promise<ShortcutResult>;
  /** Tell every other window (reading settings, a saved note, brains). */
  broadcast?(msg: AppBroadcast): Promise<void>;
  /** The main window's unread count + brains, for the menubar menu. */
  setTrayState?(state: TrayState): Promise<void>;
  /** Any window changed the app settings (theme, locale, session…). */
  onSettingsChanged?(cb: (s: AppSettings) => void): Unsubscribe;
  onBroadcast?(cb: (msg: AppBroadcast) => void): Unsubscribe;
  /** Spotlight: shown again (reset + focus the field). */
  onWindowShown?(cb: () => void): Unsubscribe;
  /** Settings window: switch to a section (a deep link, a menu item). */
  onSettingsSection?(cb: (section: SettingsSectionId) => void): Unsubscribe;

  // events
  onCommand(cb: (e: CommandEvent) => void): Unsubscribe;
  onDeepLink(cb: (e: DeepLinkEvent) => void): Unsubscribe;
  onOpenFile(cb: (e: OpenFileEvent) => void): Unsubscribe;
  onNotificationClick(cb: (e: NotificationClickEvent) => void): Unsubscribe;
  onSystemThemeChanged(cb: (dark: boolean) => void): Unsubscribe;
  onWindowState(cb: (e: WindowStateEvent) => void): Unsubscribe;
  onUpdateState(cb: (e: UpdateState) => void): Unsubscribe;
  /** MH-450 app lock: app activation / screen lock / suspend (src/main/app-activity.ts). */
  onAppActivity(cb: (e: AppActivityEvent) => void): Unsubscribe;
  /** MH-450 importers: scan progress (desktop-only). */
  onImportProgress?(cb: (e: ImportProgressEvent) => void): Unsubscribe;

  /* Desktop services (src/main/services.ts). Optional: absent from the
   * browser preview bridge — callers use `?.` (src/renderer/services/offline.ts
   * wraps them). */
  /** Cached notes of a brain, instantly (no network). */
  offlineNotes?(namespace: string, query?: OfflineQuery): Promise<OfflineNotesResult>;
  offlineNote?(namespace: string, id: string): Promise<OfflineNote | null>;
  offlineBrains?(): Promise<OfflineBrains>;
  /** Cached version metadata of a note; refreshed in the background when online. */
  offlineVersions?(namespace: string, id: string): Promise<OfflineVersions>;
  /** Write-through: a note the renderer just received from the API. */
  offlinePut?(note: OfflineNote): Promise<void>;
  /** Queue an edit (works offline); returns the optimistic note. */
  offlineEnqueue?(edit: OfflineEdit): Promise<OfflineEnqueueResult>;
  /** The version a PUT based on `version` should send, given this app's own
   *  queued pushes since (v -> v+1 written by the queue). Also maps a
   *  pushed `local:` id to its server id. */
  offlineResolveBase?(id: string, version: number): Promise<{ id: string; version: number; pending: boolean }>;
  offlineSyncNow?(): Promise<SyncStatus>;
  offlineStatus?(): Promise<SyncStatus>;
  /** Drop the local cache (pending edits are kept unless `includeQueue`). */
  offlineClear?(includeQueue?: boolean): Promise<SyncStatus>;
  offlineDismissConflict?(id: string): Promise<SyncStatus>;
  /** Show the Quick Capture panel. */
  openQuickCapture?(): Promise<void>;
  captureInit?(): Promise<CaptureInit>;
  captureSave?(req: CaptureSaveRequest): Promise<CaptureSaveResult>;
  captureClose?(): Promise<void>;
  captureClipboard?(): Promise<ClipboardCapture>;
  captureBrowserTab?(): Promise<BrowserTabResult>;
  getServicesInfo?(): Promise<ServicesInfo>;
  /** Validate, register and persist a new Quick Capture accelerator
   *  (null = platform default, "" = off). */
  setQuickCaptureShortcut?(accelerator: string | null): Promise<ShortcutResult>;
  /** macOS share sheet menu; clipboard / mail fallback elsewhere. */
  shareNote?(req: ShareRequest): Promise<ShareResult>;
  /** A notification with actions / reply (onNotificationAction). */
  notifyRich?(req: RichNotifyRequest): Promise<void>;
  onSyncStatus?(cb: (e: SyncStatus) => void): Unsubscribe;
  onSyncChange?(cb: (e: SyncChangeEvent) => void): Unsubscribe;
  onNotificationAction?(cb: (e: NotificationActionEvent) => void): Unsubscribe;
  /** Capture panel only: it was shown again (reset / focus). */
  onCaptureShow?(cb: (e: CaptureInit) => void): Unsubscribe;
}

export * from "./services";
import type {
  BrowserTabResult,
  CaptureInit,
  CaptureSaveRequest,
  CaptureSaveResult,
  ClipboardCapture,
  NotificationActionEvent,
  OfflineBrains,
  OfflineEdit,
  OfflineEnqueueResult,
  OfflineNote,
  OfflineNotesResult,
  OfflineQuery,
  OfflineVersions,
  RichNotifyRequest,
  ServicesInfo,
  ShareRequest,
  ShareResult,
  ShortcutResult,
  SyncChangeEvent,
  SyncStatus,
} from "./services";

/** File extensions the app opens (fileAssociations + open-file + dialog). */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx"] as const;
