import { isEditorRoute } from "./update-core";

/*
"Is there work an update restart could lose?" — asked before any restart.

The note editor's autosave (features/editor/autosave-core.ts) keeps its
Autosaver inside the note screen and exposes no global getter, so the updater
cannot read its dirty state without editing the editor. Until the editor
registers a probe here, the guard is the ROUTE: while the note editor screen
is open (/note/<id>) the updater never restarts the app and never pops its
sheet — it downloads quietly and applies later (on leaving the editor for a
mandatory update, on the next resume otherwise). The editor flushes its
autosave when the app goes to the background, which is when a non-mandatory
update applies.

To make the guard exact, the editor can add (one line, in the note screen):

    useEffect(() => registerUnsavedWorkProbe(() => saver.isDirty || saver.inConflict), [saver]);
*/

type Probe = () => boolean;
const probes = new Set<Probe>();
let currentPath = "";

export function registerUnsavedWorkProbe(probe: Probe): () => void {
  probes.add(probe);
  return () => probes.delete(probe);
}

/** Kept current by UpdateHost (usePathname). */
export function setCurrentPath(pathname: string): void {
  currentPath = pathname;
}

export function isEditing(): boolean {
  return isEditorRoute(currentPath);
}

export function hasUnsavedWork(): boolean {
  for (const probe of probes) {
    try {
      if (probe()) return true;
    } catch {
      /* a broken probe must not block updates forever */
    }
  }
  return isEditing();
}
