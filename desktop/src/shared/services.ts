// Desktop services contract: offline cache + sync, Quick Capture, OS
// integration (login item, Dock / Jump List, share, rich notifications).
// Re-exported by src/shared/ipc.ts, which owns the channel names and the
// ZekraBridge methods; this file only carries the payload types.
//
// Same rules as ipc.ts: types and plain const data only — compiled by tsc for
// main and bundled by esbuild into the preload and both renderer entries.

/* ------------------------------------------------------------ notes */

/** Fields an offline edit can change (the PUT /api/notes/{id} body). */
export interface OfflineNotePatch {
  title?: string;
  body?: string;
  tags?: string[];
  category?: string;
  pinned?: boolean;
  archived?: boolean;
  icon?: string;
  color?: string;
}

export type OfflinePatchField = keyof OfflineNotePatch;

/** A note as the cache holds it: the server's Note JSON (plugins/brain
 *  notes.go) plus local-state flags. Structurally a superset of the
 *  renderer's `Note` (lib/api.ts), so it can be handed to the list as is. */
export interface OfflineNote {
  id: string;
  namespace: string;
  title: string;
  body?: string;
  tags: string[];
  category?: string;
  icon?: string;
  color?: string;
  pinned: boolean;
  archived: boolean;
  indexed: boolean;
  indexError?: string;
  chunks: number;
  version: number;
  createdAt?: string;
  updatedAt: string;
  deleted?: boolean;
  source?: string;
  /** Local edits for this note are queued and not yet on the server. */
  pending?: boolean;
  /** Created offline: the id is a temporary `local:…` id until pushed. */
  localOnly?: boolean;
}

/** GET /api/notes/{id}/versions entry without its body (metadata only). */
export interface OfflineVersionMeta {
  version: number;
  title: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  source: string;
  authorUserId?: string;
  authorAgent?: string;
  createdAt: string;
}

export interface OfflineVersions {
  id: string;
  versions: OfflineVersionMeta[];
  fetchedAt: string | null;
}

export interface OfflineBrain {
  namespace: string;
  role: string;
  canWrite: boolean;
  memories: number;
  displayName?: string;
  description?: string;
  colorHex?: string;
  icon?: string;
  imageUrl?: string;
}

export interface OfflineBrains {
  brains: OfflineBrain[];
  fetchedAt: string | null;
}

export type OfflineFilter = "all" | "pinned" | "archived";
export type OfflineSort = "updated" | "created" | "title";

/** A cache read. Mirrors the notes list views (features/notes/notes-model). */
export interface OfflineQuery {
  filter?: OfflineFilter;
  sort?: OfflineSort;
  /** Case-insensitive substring of title or body (like the server's ILIKE). */
  q?: string;
  tag?: string;
  offset?: number;
  /** Default 100, max 1000. */
  limit?: number;
}

export interface OfflineNotesResult {
  namespace: string;
  notes: OfflineNote[];
  total: number;
  /** Offset of the next page, when there is one. */
  nextOffset?: number;
  /** When this brain last finished a pull; null = never synced. */
  syncedAt: string | null;
  /** A full pull has completed at least once (the cache holds every note). */
  complete: boolean;
}

/** An edit made through the offline queue. */
export interface OfflineEdit {
  kind: "create" | "update" | "delete";
  namespace: string;
  /** Required for update/delete (a real id or a `local:` id). */
  id?: string;
  /** The version the edit was based on (update/delete). */
  baseVersion?: number;
  patch?: OfflineNotePatch;
  /** The values the patched fields had at `baseVersion` (for the 3-way
   *  merge on a 409). Optional: the cached copy is used when it matches. */
  base?: OfflineNotePatch;
  /** The note as the renderer holds it — used when the cache does not have
   *  it yet (a brain still on its first pull). */
  note?: OfflineNote;
  source?: string;
}

export interface OfflineEnqueueResult {
  ok: boolean;
  opId?: string;
  /** The optimistic note (null after a delete). */
  note: OfflineNote | null;
  error?: string;
}

/* ------------------------------------------------------------- sync */

export type SyncState = "idle" | "syncing" | "offline" | "paused" | "error" | "signed-out" | "disabled";
export type SyncPauseReason = "suspend" | "low-power" | "thermal" | "user";

export type SyncConflictKind =
  /** Both sides changed title/body: the server copy stays, ours became a new note. */
  | "edit-edit"
  /** We edited a note that was deleted on the server: ours became a new note. */
  | "edit-deleted"
  /** We deleted a note that was edited on the server: it was kept. */
  | "delete-edited"
  /** The server refused the edit (permission, validation). */
  | "rejected";

export interface SyncConflict {
  id: string;
  kind: SyncConflictKind;
  namespace: string;
  noteId: string;
  title: string;
  /** The "conflicted copy" note (local id until pushed, then the real id). */
  copyId?: string;
  message?: string;
  at: string;
}

export interface SyncNamespaceStatus {
  namespace: string;
  notes: number;
  syncedAt: string | null;
  complete: boolean;
}

export interface SyncStatus {
  enabled: boolean;
  state: SyncState;
  online: boolean;
  lastSyncedAt: string | null;
  lastError?: string;
  /** Queued local edits. */
  pending: number;
  conflicts: SyncConflict[];
  pausedReason?: SyncPauseReason | null;
  nextSyncAt?: string | null;
  namespaces: SyncNamespaceStatus[];
  /** Bytes on disk, approximate. */
  cacheBytes?: number;
}

/** Notes that changed in the cache (pull, push, a local edit, a clear). */
export interface SyncChangeEvent {
  namespace: string;
  upserted: OfflineNote[];
  removed: string[];
  /** local: temporary id -> the server id it was created as. */
  idMap?: Record<string, string>;
  reason: "pull" | "push" | "local" | "conflict" | "clear";
  /** The first ever pull of this brain (a bulk load, not "new" notes). */
  initial?: boolean;
}

/* ---------------------------------------------------- quick capture */

export interface CaptureBrain {
  namespace: string;
  displayName?: string;
  icon?: string;
  colorHex?: string;
  canWrite: boolean;
}

/** What the capture panel needs each time it opens. */
export interface CaptureInit {
  brains: CaptureBrain[];
  lastBrain: string | null;
  locale: "en" | "ar";
  dark: boolean;
  platform: "darwin" | "win32" | "linux";
  /** The system material behind the panel (macOS hud vibrancy, Windows 11 acrylic). */
  material: "vibrancy" | "acrylic" | "none";
  /** Display form of the global shortcut ("" when disabled). */
  shortcut: string;
  /** Browser-tab capture is available on this OS (macOS AppleScript). */
  browserCapture: boolean;
  signedIn: boolean;
  online: boolean;
  /** Pre-filled content (Dock / tray "Capture Clipboard", etc.). */
  prefill?: { title?: string; body?: string; tags?: string[] };
}

export interface CaptureSaveRequest {
  namespace: string;
  title: string;
  body: string;
  tags: string[];
}

export interface CaptureSaveResult {
  ok: boolean;
  /** Saved to the offline queue only (no network right now). */
  queued: boolean;
  error?: string;
}

export interface BrowserTabResult {
  status: "ok" | "unsupported" | "denied" | "no-browser" | "error";
  url?: string;
  title?: string;
  browser?: string;
  message?: string;
}

export interface ClipboardCapture {
  text: string;
  /** Set when the clipboard holds a single URL. */
  url?: string;
}

/* ------------------------------------------------------ os services */

export interface ShareRequest {
  title: string;
  markdown: string;
  namespace?: string;
  id?: string;
  /** Share a temporary .md file too (AirDrop / Mail attachment). macOS only. */
  asFile?: boolean;
  /** "mail": Windows/Linux "Email…" fallback (a mailto: with the note). */
  via?: "share" | "mail";
}

export interface ShareResult {
  status: "shared" | "copied" | "error";
  /** share-menu: macOS NSSharingServicePicker; clipboard / mailto elsewhere. */
  method: "share-menu" | "clipboard" | "mailto";
  message?: string;
}

export interface NotificationAction {
  id: string;
  label: string;
}

/** A notification with actions / an inline reply where the OS supports it
 *  (macOS: actions + reply, signed builds with "Alerts" style; Windows:
 *  toast buttons; Linux: depends on the notification daemon). */
export interface RichNotifyRequest {
  title: string;
  body?: string;
  route?: string;
  silent?: boolean;
  actions?: NotificationAction[];
  reply?: { placeholder: string };
  /** Opaque, handed back with the action (e.g. a notification id). */
  tag?: string;
}

export interface NotificationActionEvent {
  /** An action id, "click", or "reply". */
  action: string;
  route?: string;
  tag?: string;
  reply?: string;
}

export interface ServicesInfo {
  platform: "darwin" | "win32" | "linux";
  /** The effective accelerator ("" = disabled). */
  quickCaptureShortcut: string;
  /** The platform default, for the "Reset" button. */
  defaultShortcut: string;
  shortcutRegistered: boolean;
  shortcutError?: string;
  /** The OS's own login-item state (may differ from the setting if the user
   *  removed it in System Settings). */
  launchAtLogin: boolean;
  shareMenu: boolean;
  browserCapture: boolean;
  notificationActions: boolean;
}

/** Result of changing the Quick Capture shortcut. */
export interface ShortcutResult {
  ok: boolean;
  accelerator: string;
  error?: "invalid" | "in-use" | "failed";
}
