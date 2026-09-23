import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { Alert } from "react-native";

import { toast } from "@/components/kit";
import { ApiError, type Note, type NotePage, type NotePatch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";

import { noteKeys, notesApi } from "./api";
import { applyNote, findNote, removeNote, type NoteView } from "./notes-core";

type Pages = InfiniteData<NotePage, string | undefined>;

/** Error message for a failed write, or null on success. */
export type WriteResult = Promise<string | null>;

/** Callbacks for a confirmed action: `onConfirm` runs as soon as the user
 *  agrees (close a sheet, a swiped row), `onDone` once the server answered. */
export type ConfirmHooks = { onConfirm?: () => void; onDone?: (error: string | null) => void };

export type NoteActions = {
  togglePin(note: Note): WriteResult;
  /** Icon/colour override (MH-308); "" clears it back to the category default. */
  setAppearance(note: Note, patch: Pick<NotePatch, "icon" | "color">): WriteResult;
  askArchive(note: Note, hooks?: ConfirmHooks): void;
  askDelete(note: Note, hooks?: ConfirmHooks): void;
  askRestore(note: Note, version: number, hooks?: ConfirmHooks): void;
};

/**
 * Every write the notes list makes, in one place, so the swipe buttons and the
 * long-press sheet behave identically:
 *   - optimistic: the loaded pages change at once (a note that leaves the view
 *     — archived out of "All", unpinned out of "Pinned" — leaves the list), and
 *     roll back if the server refuses;
 *   - never silent: every failure is a danger toast (and returned, for callers
 *     that sit under a modal, where the toast host cannot be seen);
 *   - conflict-aware: a 409 carries the server's current note, which replaces
 *     the stale row before the lists refetch;
 *   - serial per note: each write is based on the version the previous one
 *     returned, so two quick taps do not race into a 409.
 * Archive, delete and restore confirm first, as on web; pin does not — it is
 * trivially reversible.
 */
export function useNoteActions(namespace: string): NoteActions {
  const { token } = useAuth();
  const client = useQueryClient();
  const { t } = useI18n();
  const queues = useRef(new Map<string, Promise<unknown>>());

  return useMemo(() => {
    const lists = noteKeys.lists(namespace);

    const snapshot = () => client.getQueriesData<Pages>({ queryKey: lists });
    const rollback = (snap: ReturnType<typeof snapshot>) => {
      for (const [key, data] of snap) client.setQueryData(key, data);
    };

    /** Rewrite every loaded list of this brain; each key carries its view. */
    const each = (fn: (pages: NotePage[], view: NoteView) => NotePage[]) => {
      for (const [key, data] of client.getQueriesData<Pages>({ queryKey: lists })) {
        const view = key[3] as NoteView | undefined;
        if (!data || !view) continue;
        client.setQueryData<Pages>(key, { ...data, pages: fn(data.pages, view) });
      }
    };
    const put = (note: Note) => each((pages, view) => applyNote(pages, note, view.filter));
    const drop = (id: string) => each((pages) => removeNote(pages, id));

    /** The freshest copy of a note any loaded list holds. */
    const latest = (id: string): Note | undefined => {
      for (const [, data] of client.getQueriesData<Pages>({ queryKey: lists })) {
        const hit = data && findNote(data.pages, id);
        if (hit) return hit;
      }
      return undefined;
    };

    const refresh = (id: string) => {
      void client.invalidateQueries({ queryKey: lists });
      // The note screen's cache, whatever its exact key shape (see api.ts).
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] === "note" && q.queryKey.includes(id) });
    };

    const describe = (error: unknown): string => {
      if (error instanceof ApiError) {
        if (error.status === 0) return t("notes.x.offline");
        if (error.status === 409) return t("notes.x.conflict");
      }
      return error instanceof Error && error.message ? error.message : t("notes.x.failed");
    };

    const fail = (error: unknown): string => {
      if (error instanceof ApiError && error.status === 409) {
        const current = (error.payload as { current?: Note } | undefined)?.current;
        if (current && !current.deleted) put(current);
      }
      const message = describe(error);
      toast(message, "danger");
      return message;
    };

    const serial = (id: string, run: () => Promise<string | null>): WriteResult => {
      const prev = queues.current.get(id) ?? Promise.resolve();
      const next = prev.then(run, run);
      queues.current.set(id, next);
      const settle = () => {
        if (queues.current.get(id) === next) queues.current.delete(id);
      };
      next.then(settle, settle);
      return next;
    };

    const write = (note: Note, patch: NotePatch, done?: string): WriteResult =>
      serial(note.id, async () => {
        if (!token) return fail(new ApiError(401, t("notes.x.failed")));
        const base = latest(note.id) ?? note;
        await client.cancelQueries({ queryKey: lists });
        const snap = snapshot();
        put({ ...base, ...patch });
        try {
          put(await notesApi.update(token, base, patch));
          if (done) toast(done, "ok");
          return null;
        } catch (error) {
          rollback(snap);
          return fail(error);
        } finally {
          refresh(note.id);
        }
      });

    const remove = (note: Note): WriteResult =>
      serial(note.id, async () => {
        if (!token) return fail(new ApiError(401, t("notes.x.failed")));
        const base = latest(note.id) ?? note;
        await client.cancelQueries({ queryKey: lists });
        const snap = snapshot();
        drop(note.id);
        try {
          await notesApi.remove(token, base);
          client.removeQueries({ queryKey: noteKeys.versions(namespace, note.id) });
          toast(t("notes.x.deleted"), "ok");
          return null;
        } catch (error) {
          rollback(snap);
          return fail(error);
        } finally {
          refresh(note.id);
        }
      });

    const restore = (note: Note, version: number): WriteResult =>
      serial(note.id, async () => {
        if (!token) return fail(new ApiError(401, t("notes.x.failed")));
        try {
          put(await notesApi.restore(token, note.id, version));
          void client.invalidateQueries({ queryKey: noteKeys.versions(namespace, note.id) });
          toast(t("notes.x.restored", { n: version }), "ok");
          return null;
        } catch (error) {
          return fail(error);
        } finally {
          refresh(note.id);
        }
      });

    const confirm = (title: string, body: string, action: string, destructive: boolean, run: () => WriteResult, hooks?: ConfirmHooks) => {
      Alert.alert(title, body, [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: action,
          style: destructive ? "destructive" : "default",
          onPress: () => {
            hooks?.onConfirm?.();
            void run().then((error) => hooks?.onDone?.(error));
          },
        },
      ]);
    };

    return {
      togglePin(note) {
        const pinned = !(latest(note.id) ?? note).pinned;
        return write(note, { pinned }, pinned ? t("notes.x.pinned") : t("notes.x.unpinned"));
      },
      setAppearance(note, patch) {
        return write(note, patch);
      },
      askArchive(note, hooks) {
        const archived = !(latest(note.id) ?? note).archived;
        confirm(
          archived ? t("notes.x.archiveTitle") : t("notes.x.unarchiveTitle"),
          archived ? t("notes.x.archiveBody") : t("notes.x.unarchiveBody"),
          archived ? t("notes.x.archive") : t("notes.x.unarchive"),
          false,
          () => write(note, { archived }, archived ? t("notes.x.archived") : t("notes.x.unarchived")),
          hooks,
        );
      },
      askDelete(note, hooks) {
        confirm(t("notes.x.deleteTitle"), t("notes.x.deleteBody"), t("notes.x.delete"), true, () => remove(note), hooks);
      },
      askRestore(note, version, hooks) {
        confirm(t("notes.x.restoreTitle", { n: version }), t("notes.x.restoreBody"), t("notes.x.restore"), false, () => restore(note, version), hooks);
      },
    };
  }, [client, namespace, t, token]);
}
