/*
The editor's content operations: immutable reads and writes by path, the API's error
locations ("content.slides[1].bullets[0]") as paths, list edits, and changing an item's type
while keeping the fields both types share. Pure, so they are tested without a browser.
*/
import type { FieldError } from "./types.ts"

export type Key = string | number
export type Path = Key[]
type Obj = Record<string, unknown>

/** "steps.2.title" or "content.slides[1].bullets[0]" → ["steps", 2, "title"]. */
export function parsePath(path: string): Path {
  const out: Path = []
  for (const part of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
    if (part === "") continue
    out.push(/^\d+$/.test(part) ? Number(part) : part)
  }
  return out
}

export const pathKey = (path: Path) => path.join(".")

export function getIn(root: unknown, path: Path): unknown {
  let cur = root
  for (const k of path) {
    if (cur == null || typeof cur !== "object") return undefined
    cur = (cur as Obj)[k as string]
  }
  return cur
}

/** Sets a value, copying only the containers on the way. `undefined` removes an object key. */
export function setIn<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T
  const [head, ...rest] = path
  if (typeof head === "number") {
    const list = Array.isArray(root) ? root.slice() : []
    list[head] = setIn(list[head], rest, value)
    return list as unknown as T
  }
  const obj: Obj = root && typeof root === "object" && !Array.isArray(root) ? { ...(root as Obj) } : {}
  const next = setIn(obj[head], rest, value)
  if (next === undefined && rest.length === 0) delete obj[head]
  else obj[head] = next
  return obj as unknown as T
}

export function insertAt<T>(root: T, listPath: Path, index: number, item: unknown): T {
  const list = (getIn(root, listPath) as unknown[] | undefined) ?? []
  const next = list.slice()
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item)
  return setIn(root, listPath, next)
}

export function removeAt<T>(root: T, listPath: Path, index: number): T {
  const list = (getIn(root, listPath) as unknown[] | undefined) ?? []
  return setIn(
    root,
    listPath,
    list.filter((_, i) => i !== index),
  )
}

/** An empty sibling for a list: "" for strings, the same keys blanked for objects. */
export function blankLike(sample: unknown): unknown {
  if (typeof sample === "number") return 0
  if (Array.isArray(sample)) return sample.map(blankLike)
  if (sample && typeof sample === "object") {
    const out: Obj = {}
    for (const [k, v] of Object.entries(sample as Obj)) {
      if (typeof v === "string") out[k] = ""
      else if (Array.isArray(v)) out[k] = k === "cells" ? v.map(() => "") : []
    }
    return out
  }
  return ""
}

/** A step/marker id that is not taken yet. */
export function freshId(list: unknown[], base = "item"): string {
  const taken = new Set(list.map((x) => (x && typeof x === "object" ? String((x as Obj).id ?? "") : "")))
  for (let n = list.length + 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** The API's errors under one path prefix, with their paths made relative to it. */
export function errorsUnder(errors: FieldError[], prefix: Path): { path: Path; message: string; hint?: string }[] {
  const out: { path: Path; message: string; hint?: string }[] = []
  for (const e of errors) {
    let p = parsePath(e.path)
    if (p[0] === "content") p = p.slice(1)
    if (p.length < prefix.length || prefix.some((k, i) => p[i] !== k)) continue
    out.push({ path: p.slice(prefix.length), message: e.message, hint: e.hint })
  }
  return out
}

// Fields that mean the same thing under another name in another type.
const ALIASES: [string, string][] = [
  ["title", "heading"],
  ["subtitle", "body"],
  ["text", "body"],
  ["quote", "title"],
  ["quote", "heading"],
  ["image_url", "url"],
]

/**
 * Changes an item's type: starts from the new type's template and carries over every field
 * the new type also has (by name, or by a known alias such as title ↔ heading), so a title
 * slide turned into bullets keeps its title and notes.
 */
export function convertType(item: Obj, template: Obj, allowed?: string[]): Obj {
  const out: Obj = JSON.parse(JSON.stringify(template)) as Obj
  const can = (k: string) => (allowed ? allowed.includes(k) : k in template || k === "notes" || k === "build")
  for (const [k, v] of Object.entries(item)) {
    if (k === "type" || v === undefined) continue
    if (can(k) && sameShape(v, template[k])) out[k] = v
  }
  const carried = new Set(Object.keys(item).filter((k) => can(k)))
  for (const [a, b] of ALIASES) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const v = item[from]
      if (typeof v !== "string" || !v || carried.has(from) || carried.has(to) || !can(to)) continue
      if (template[to] !== undefined && typeof template[to] !== "string") continue
      out[to] = v
      carried.add(to)
    }
  }
  return out
}

function sameShape(a: unknown, b: unknown): boolean {
  if (b === undefined) return true
  if (Array.isArray(a) !== Array.isArray(b)) return false
  return typeof a === typeof b
}

// ---- undo / redo -------------------------------------------------------------

export type History<T> = { past: T[]; present: T; future: T[]; key: string; at: number }

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [], key: "", at: 0 })

/** Records a change. Changes with the same `key` within `window` ms fold into one step (typing). */
export function record<T>(h: History<T>, next: T, key = "", now = Date.now(), window = 1000, limit = 200): History<T> {
  if (next === h.present) return h
  if (key && key === h.key && now - h.at < window && h.past.length) return { ...h, present: next, future: [], at: now }
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [], key, at: now }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: "", at: 0 }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), key: "", at: 0 }
}
