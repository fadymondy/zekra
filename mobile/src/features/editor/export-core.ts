/*
Pure pieces of note export (filename, file types, PNG sizing), testable
without Expo.
*/

export type ExportKind = "md" | "html" | "pdf" | "docx" | "png" | "txt";

export const EXPORT_TYPES: Record<ExportKind, { ext: string; mime: string; uti: string }> = {
  md: { ext: "md", mime: "text/markdown", uti: "net.daringfireball.markdown" },
  html: { ext: "html", mime: "text/html", uti: "public.html" },
  pdf: { ext: "pdf", mime: "application/pdf", uti: "com.adobe.pdf" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", uti: "org.openxmlformats.wordprocessingml.document" },
  png: { ext: "png", mime: "image/png", uti: "public.png" },
  txt: { ext: "txt", mime: "text/plain", uti: "public.plain-text" },
};

/**
 * A filename from a note title. Same rules as web's safeFilename
 * (components/notes/note-export.tsx) — quotes/newlines/backslashes dropped,
 * path and wildcard characters to "-", 80 chars — plus what a phone's file
 * system also rejects: control characters and a leading dot (hidden file).
 * Arabic and other scripts pass through untouched.
 */
export function safeFilename(title: string): string {
  const cleaned = (title ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\]/g, "")
    .replace(/[/?%*:|<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  // Slice by code point so a surrogate pair (emoji) is never cut in half.
  return Array.from(cleaned).slice(0, 80).join("").trim() || "note";
}

export function exportFilename(title: string, kind: ExportKind): string {
  return `${safeFilename(title)}.${EXPORT_TYPES[kind].ext}`;
}

/**
 * Device-pixel ratio for a PNG capture: 2x for crispness, reduced so the
 * canvas stays under iOS WebKit's ~16.7M pixel limit (a long note at 2x
 * otherwise produces a blank image rather than an error).
 */
export function pngPixelRatio(width: number, height: number, max = 2, maxArea = 16_000_000): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const fit = Math.sqrt(maxArea / (width * height));
  return Math.max(0.25, Math.min(max, Math.floor(fit * 100) / 100));
}
