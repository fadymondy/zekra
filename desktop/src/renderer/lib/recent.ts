import { useEffect, useState } from "react";

import { forgetRecent as forget, loadRecent, pushRecent as push, type RecentNote } from "@/lib/notes/recent-notes";

/*
The web's recent-notes store (localStorage), plus a change event so the
sidebar's "Recent notes" section updates the moment a note is opened.
*/
const EVENT = "zekra:recent-notes";

export function pushRecentNote(note: { id: string; namespace: string; title: string; category?: string }): void {
  push(note);
  window.dispatchEvent(new Event(EVENT));
}

export function forgetRecentNote(id: string): void {
  forget(id);
  window.dispatchEvent(new Event(EVENT));
}

export function useRecentNotes(): RecentNote[] {
  const [list, setList] = useState<RecentNote[]>(loadRecent);
  useEffect(() => {
    const reload = () => setList(loadRecent());
    window.addEventListener(EVENT, reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener(EVENT, reload);
      window.removeEventListener("focus", reload);
    };
  }, []);
  return list;
}
