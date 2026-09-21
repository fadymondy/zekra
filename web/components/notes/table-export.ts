/*
The pure half of the table behaviour: ordering and the export encoders.

Kept in its own .ts module rather than inside table-actions.tsx because Node's
type-stripping cannot parse JSX, so anything exported from a .tsx file is
untestable with `node --test`. These are exactly the functions worth testing —
a quiet bug here corrupts exported data rather than merely looking wrong.
*/

export type Rows = { headers: string[]; rows: string[][] }

/**
 * Numbers must sort numerically, not lexically, or 10 lands between 1 and 2.
 * Everything else falls back to a locale compare so accented text and Arabic
 * order sensibly.
 */
export function compare(a: string, b: string): number {
  const na = Number(a.replace(/[,\s]/g, ""))
  const nb = Number(b.replace(/[,\s]/g, ""))
  // The emptiness guard matters: Number("") is 0, so without it an empty cell
  // would sort among the numbers instead of as text.
  const bothNumeric = a.trim() !== "" && b.trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb)
  if (bothNumeric) return na - nb
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

/** RFC 4180: quote when the value holds a comma, quote or newline. */
export function csvCell(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv({ headers, rows }: Rows): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")
}

export function toMarkdown({ headers, rows }: Rows): string {
  // An unescaped pipe inside a cell would split it into two columns.
  const esc = (s: string) => s.replace(/\|/g, "\\|")
  return [
    `| ${headers.map(esc).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n")
}

export function toJson({ headers, rows }: Rows): string {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))),
    null,
    2,
  )
}
