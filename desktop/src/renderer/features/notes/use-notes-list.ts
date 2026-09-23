import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Note, NotePage } from "../../lib/api";
import { notesApi } from "./notes-api";
import { applyNote, prependNote, removeNote, visibleNotes, type NoteView } from "./notes-model";

/*
One brain's notes list for one view ({filter, sort, q}): cursor pages loaded
on demand (infinite scroll), optimistic local edits (a pin moves the row, an
archive drops it) and a reload. A view change starts over; a response for a
view the user has already left is dropped.
*/
export function useNotesList(token: string, ns: string, view: NoteView) {
  const [pages, setPages] = useState<NotePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);
  const viewKey = `${ns}|${view.filter}|${view.sort}|${view.q}`;
  const viewRef = useRef(view);
  viewRef.current = view;

  const reload = useCallback(async () => {
    const mine = ++gen.current;
    setLoading(true);
    try {
      const first = await notesApi.list(token, ns, viewRef.current);
      if (gen.current !== mine) return;
      setPages([first]);
      setError(null);
    } catch (e) {
      if (gen.current !== mine) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (gen.current === mine) setLoading(false);
    }
  }, [token, ns]);

  useEffect(() => {
    setPages([]);
    void reload();
  }, [viewKey, reload]);

  const cursor = pages.length ? pages[pages.length - 1].nextCursor : undefined;

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loading) return;
    const mine = gen.current;
    setLoadingMore(true);
    try {
      const next = await notesApi.list(token, ns, viewRef.current, cursor);
      if (gen.current !== mine) return;
      setPages((p) => [...p, next]);
    } catch (e) {
      if (gen.current === mine) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, loading, token, ns]);

  const notes = useMemo(() => visibleNotes(pages, view.filter), [pages, view.filter]);

  /** Reflect a changed note (moves or drops the row per the view). */
  const upsert = useCallback(
    (note: Note) => {
      setPages((p) => {
        const has = p.some((pg) => pg.notes?.some((n) => n.id === note.id));
        return has ? applyNote(p, note, viewRef.current.filter) : prependNote(p, note, viewRef.current.filter);
      });
    },
    [],
  );
  const remove = useCallback((id: string) => setPages((p) => removeNote(p, id)), []);

  return { notes, loading, loadingMore, error, hasMore: !!cursor, loadMore, reload, upsert, remove };
}
