// Zekra's cube mark comes from the grid's product marks (synced from fadymondy.com-v2).
// The entry is keyed `zekra` here; the upstream copy is not ours to change, so a
// re-sync of grid-marks.ts must keep that key. PRODUCT_MARKS is a Record<string, …>,
// so a missing key is `undefined` at runtime rather than a type error — hence the
// explicit check below instead of a silently blank logo.
export type { Cell, MarkSpec } from "@/app/styles/grid-marks"
import { PRODUCT_MARKS, type MarkSpec } from "@/app/styles/grid-marks"

const mark = PRODUCT_MARKS.zekra
if (!mark) throw new Error("grid-marks.ts has no `zekra` entry — keep the key when re-syncing it")

export const ZEKRA_MARK: MarkSpec = mark
