import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, type Note, type NotePage } from "../../lib/api";
import { cachedNotesPage, isOfflineCursor, nextCachedPage, onSyncChange } from "../../services/offline";
import { notesApi } from "./notes-api";
import { applyNote, prependNote, removeNote, visibleNotes, type NoteView } from "./notes-model";

/*
One brain's notes list for one view ({filter, sort, q}): cursor pages loaded
on demand (infinite scroll), optimistic local edits (a pin moves the row, an
archive drops it) and a reload. A view change starts over; a response for a
view the user has already left is dropped.

Desktop: cache-first (services/offline.ts). The first page is painted from
the offline cache before the network answers; offline, the cached pages stand
in (their cursors are `offline:<n>`), and background sync changes — pulls,
pushed edits, conflict copies — are applied to the loaded pages live.
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
    const cached = await cachedNotesPage(ns, viewRef.current);
    if (gen.current !== mine) return;
    if (cached) {
      setPages([cached]);
      setLoading(false);
    }
    try {
      const first = await notesApi.list(token, ns, viewRef.current);
      if (gen.current !== mine) return;
      setPages([first]);
      setError(null);
    } catch (e) {
      if (gen.current !== mine) return;
      // Offline with a cache: the cached list stands; not an error.
      if (cached && e instanceof ApiError && e.status === 0) setError(null);
      else setError(e instanceof Error ? e.message : String(e));
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
      const next = isOfflineCursor(cursor)
        ? await nextCachedPage(ns, viewRef.current, cursor!)
        : await notesApi.list(token, ns, viewRef.current, cursor);
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

  // Background sync (desktop): apply pulled / pushed / conflict changes.
  useEffect(
    () =>
      onSyncChange((e) => {
        if (e.namespace !== ns || e.reason === "clear") return;
        const q = viewRef.current.q.trim().toLowerCase();
        const matches = (n: Note) =>
          !q ||
          n.title.toLowerCase().includes(q) ||
          (n.description ?? "").toLowerCase().includes(q) ||
          (n.body ?? "").toLowerCase().includes(q);
        setPages((p) => {
          if (!p.length) return p;
          let next = p;
          for (const id of e.removed) next = removeNote(next, id);
          for (const raw of e.upserted) {
            const n = raw as unknown as Note;
            const has = next.some((pg) => pg.notes?.some((x) => x.id === n.id));
            if (has) next = applyNote(next, n, viewRef.current.filter);
            // New to this list: a first bulk pull only fills the cache.
            else if (!e.initial && matches(n)) next = prependNote(next, n, viewRef.current.filter);
          }
          return next;
        });
      }),
    [ns],
  );

  return { notes, loading, loadingMore, error, hasMore: !!cursor, loadMore, reload, upsert, remove };
}
