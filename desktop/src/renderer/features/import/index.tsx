import { useState } from "react";

import type { ImportSource } from "../../../shared/ipc";
import { useCommand } from "../../shell/commands";
import { ImportDialog } from "./import-dialog";

/*
File ▸ Import from ▸ … (MH-450). Takes over the shell's "coming soon" stubs
for the four import commands and opens the import dialog for that source.
Mounted once, app-wide, by MarkItDownFeatures (features/open-file/host.tsx).
*/
export function ImportHost() {
  const [source, setSource] = useState<ImportSource | null>(null);
  useCommand("import:apple-notes", () => setSource("apple-notes"));
  useCommand("import:google-keep", () => setSource("google-keep"));
  useCommand("import:notion", () => setSource("notion"));
  useCommand("import:markdown-folder", () => setSource("markdown-folder"));
  return <ImportDialog source={source} onClose={() => setSource(null)} />;
}

export { ImportDialog } from "./import-dialog";
export { runImport } from "./run-import";
