import { useCallback, useState } from "react";

import type { OpenFileEvent } from "../../../shared/ipc";
import { useOsEvent } from "../../shell/os-events";
import { ImportHost } from "../import";
import { DocumentView } from "./document-view";
import { ActiveNoteExport, TrayRecentSync, UpdateToasts } from "./desktop-extras";

/*
Everything Zekra took over from Mark It Down's desktop app (MH-450), mounted
once next to the shell's fallback commands (app.tsx):

  ImportHost        File ▸ Import from ▸ … -> the import dialog
  DocumentHost      "open-file" (Finder, Dock, File ▸ Open Markdown… ⌘O, argv)
                    -> the document view
  ActiveNoteExport  File ▸ Export ▸ … for the active note
  TrayRecentSync    the menubar's Recent Notes
  UpdateToasts      "Restart to update"
*/
export function MarkItDownFeatures() {
  return (
    <>
      <ImportHost />
      <DocumentHost />
      <ActiveNoteExport />
      <TrayRecentSync />
      <UpdateToasts />
    </>
  );
}

function DocumentHost() {
  const [docs, setDocs] = useState<OpenFileEvent[]>([]);
  const [active, setActive] = useState("");

  // Takes over from the shell's placeholder (which parks the file); a file
  // opened again replaces its earlier copy (fresh content from disk).
  useOsEvent("open-file", (f) => {
    setDocs((cur) => [...cur.filter((d) => d.path !== f.path), f]);
    setActive(f.path);
  });

  const close = useCallback(
    (path: string) => {
      const next = docs.filter((d) => d.path !== path);
      setDocs(next);
      if (active === path) setActive(next[next.length - 1]?.path ?? "");
    },
    [docs, active],
  );

  if (!docs.length) return null;
  return <DocumentView docs={docs} activePath={active} onSelect={setActive} onClose={close} />;
}
