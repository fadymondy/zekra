"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"

import { editorExtensions } from "./editor-extensions"
import { findLossyConstructs } from "./lossy-markdown"
import { cn } from "@/lib/utils"
import { useNoteSettings } from "./note-settings-panel"
import { readerStyle } from "@/lib/notes/note-settings"
import { ImageUploadError, imageFilesFrom, uploadNoteImage } from "@/lib/notes/upload-image"

/*
In-place WYSIWYG editing over the note body, with paste-to-upload for images.

Why TipTap and not the rendered pane made contenteditable: the note's source of
truth is markdown, so editing has to round-trip through a real document model.
tiptap-markdown gives that; editing the rendered HTML directly would mean
diffing HTML back into markdown, which loses information on every pass.

What this is NOT: the reading view. NoteMarkdown still renders notes through
the ported pipeline (themes, code-block chrome, interactive tables) — this is
the editing surface, and it deliberately renders a plainer document. Keeping
the two separate is what stops an editing bug from corrupting a note nobody
was editing.

Autosave honours the Editor setting (off / on blur / every 5s) from MH-214,
which is why those values were stored before there was anything to consume
them.
*/

const AUTOSAVE_INTERVAL_MS = 5000

export interface NoteEditorProps {
  /** Markdown body. */
  value: string
  onChange: (markdown: string) => void
  /** Persist. Called by autosave and by Cmd/Ctrl+S. */
  onSave?: (markdown: string) => void | Promise<void>
  /** Brain the note lives in — required to upload images. */
  namespace: string
  editable?: boolean
  placeholder?: string
  /**
   * Override the image upload.
   *
   * The default posts same-origin to /api/notes/image with the CSRF cookie.
   * The Electron renderer mounts this same editor but talks cross-origin with
   * a Bearer token, so it supplies its own — the same seam EntityTree needed.
   */
  uploadImage?: (file: File | Blob, namespace: string) => Promise<{ url: string }>
  /** No frame: the body flows on the page under the title, as in Notes
   *  (the notes editor); the framed box is for forms and panels. */
  bare?: boolean
}

export function NoteEditorWysiwyg({
  value,
  onChange,
  onSave,
  namespace,
  editable = true,
  uploadImage = uploadNoteImage,
  bare = false,
}: NoteEditorProps) {
  const { settings } = useNoteSettings()
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState("")

  /*
  Footnotes and raw HTML blocks have no node in the schema, so opening such a
  note here and saving would silently delete them (proved in
  markdown-roundtrip.test.ts). Rather than risk that, the editor refuses until
  the user says they accept the loss. Checked on the incoming value, not on
  every keystroke.
  */
  const [override, setOverride] = useState(false)
  const lossy = useMemo(() => findLossyConstructs(value), [value])
  // A new note being opened must re-arm the guard.
  useEffect(() => setOverride(false), [value])
  // Held in a ref so the autosave interval always sees the latest body without
  // being torn down and rebuilt on every keystroke.
  const latest = useRef(value)
  const dirty = useRef(false)

  const editor = useEditor({
    editable,
    // Next renders this on the server first; without this flag TipTap warns
    // about a hydration mismatch it cannot avoid.
    immediatelyRender: false,
    // Shared with markdown-roundtrip.test.ts, so the test proves what this
    // editor actually does rather than a lookalike configuration.
    extensions: editorExtensions(),
    content: value,
    onUpdate({ editor }) {
      const md = editor.storage.markdown.getMarkdown() as string
      latest.current = md
      dirty.current = true
      onChange(md)
    },
  })

  // Reflect external changes (a different note opened, a reverted version)
  // without clobbering what is being typed.
  useEffect(() => {
    if (!editor) return
    const current = editor.storage.markdown.getMarkdown() as string
    if (value !== current) {
      editor.commands.setContent(value, { emitUpdate: false })
      latest.current = value
      dirty.current = false
    }
  }, [editor, value])

  const save = useCallback(async () => {
    if (!onSave || !dirty.current) return
    dirty.current = false
    try {
      await onSave(latest.current)
    } catch (e) {
      dirty.current = true // failed, so it is still unsaved
      setError(e instanceof Error ? e.message : "Save failed")
    }
  }, [onSave])

  // Autosave: off / on blur / every 5s.
  useEffect(() => {
    if (!editor || settings.autoSave !== "interval") return
    const id = setInterval(() => void save(), AUTOSAVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [editor, settings.autoSave, save])

  useEffect(() => {
    if (!editor || settings.autoSave !== "blur") return
    const onBlur = () => void save()
    editor.on("blur", onBlur)
    return () => {
      editor.off("blur", onBlur)
    }
  }, [editor, settings.autoSave, save])

  // Cmd/Ctrl+S always saves, whatever the autosave mode — including "off",
  // which the setting's own help text promises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void save()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [save])

  const insertImages = useCallback(
    async (files: File[]) => {
      if (!editor || files.length === 0) return
      setError("")
      setUploading((n) => n + files.length)
      for (const file of files) {
        try {
          const { url } = await uploadImage(file, namespace)
          editor.chain().focus().setImage({ src: url, alt: file.name }).run()
        } catch (e) {
          setError(e instanceof ImageUploadError ? e.message : "Image upload failed")
        } finally {
          setUploading((n) => n - 1)
        }
      }
    },
    [editor, namespace, uploadImage],
  )

  // Paste and drop both go through the same upload path.
  useEffect(() => {
    if (!editor || !editable) return
    const dom = editor.view.dom

    const onPaste = (e: ClipboardEvent) => {
      const files = imageFilesFrom(e.clipboardData)
      if (files.length === 0) return
      // Only take over when there IS an image; otherwise normal paste wins.
      e.preventDefault()
      void insertImages(files)
    }
    const onDrop = (e: DragEvent) => {
      const files = imageFilesFrom(e.dataTransfer)
      if (files.length === 0) return
      e.preventDefault()
      void insertImages(files)
    }

    dom.addEventListener("paste", onPaste)
    dom.addEventListener("drop", onDrop)
    return () => {
      dom.removeEventListener("paste", onPaste)
      dom.removeEventListener("drop", onDrop)
    }
  }, [editor, editable, insertImages])

  if (lossy.length > 0 && !override) {
    return (
      <div className="space-y-3 rounded-md border border-nq-accent/50 bg-nq-surface-soft p-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            This note uses markdown the visual editor cannot preserve.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Editing it here would remove {lossy.map((l) => l.label.toLowerCase()).join(" and ")} when it saves.
          </p>
        </div>
        <ul className="space-y-1">
          {lossy.map((l) => (
            <li key={l.kind} className="font-mono text-xs text-muted-foreground">
              {l.label}: <span className="text-foreground">{l.sample}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setOverride(true)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-card"
        >
          Edit anyway and lose them
        </button>
      </div>
    )
  }

  if (!editor) return null

  return (
    <div className="space-y-2">
      <EditorContent
        editor={editor}
        style={readerStyle(settings)}
        className={cn(EDITOR_PROSE, bare ? EDITOR_BARE : EDITOR_FRAME)}
        data-word-wrap={settings.wordWrap ? "on" : "off"}
      />
      {uploading > 0 ? (
        <p className="text-xs text-muted-foreground">
          Uploading {uploading} image{uploading === 1 ? "" : "s"}…
        </p>
      ) : null}
      {error ? <p className="text-xs text-nq-danger">{error}</p> : null}
    </div>
  )
}

/*
The editing surface is styled to match the reading pane closely enough that
switching between them is not jarring, but it is not the same stylesheet: the
reader's rules target the ported renderer's markup (figure.zk-code and the
interactive table), which TipTap does not produce.
*/
const EDITOR_FRAME = "min-h-40 rounded-md border border-border bg-background p-4 focus-within:border-nq-action focus-within:outline-none [&_.ProseMirror]:min-h-32"
const EDITOR_BARE = "[&_.ProseMirror]:min-h-[50vh]"
const EDITOR_PROSE = [
  "leading-relaxed text-foreground",
  "[&_.ProseMirror]:outline-none",
  "[&_h1]:text-xl [&_h1]:font-medium [&_h1]:mt-4 [&_h1]:mb-2",
  "[&_h2]:text-lg [&_h2]:font-medium [&_h2]:mt-4 [&_h2]:mb-2",
  "[&_h3]:font-medium [&_h3]:mt-3",
  "[&_a]:text-nq-action [&_a]:underline [&_a]:underline-offset-4",
  "[&_code]:bg-nq-surface-soft [&_code]:px-1 [&_code]:rounded-sm [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:bg-card [&_pre]:border [&_pre]:border-border [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_ul]:list-disc [&_ul]:list-outside [&_ul]:ps-5",
  "[&_ol]:list-decimal [&_ol]:list-outside [&_ol]:ps-5",
  "[&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground",
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md",
  "[&_table]:w-full [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-nq-surface-soft",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
  // Word wrap off means long lines scroll rather than fold.
  "[&[data-word-wrap=off]_.ProseMirror]:whitespace-pre [&[data-word-wrap=off]]:overflow-x-auto",
].join(" ")
