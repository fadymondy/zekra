/*
A keyed stack of handlers — the dispatch core shared by the command bus
(commands.tsx) and the OS-event bus (os-events.tsx).

- register(key, fn): push; returns an unregister function.
- dispatch(key, e): the most recently registered handler runs first; one that
  returns `false` passes the event down. Returns whether anything took it.
- defer(key, e, ttl): park an event until a handler for `key` registers
  (within `ttl` ms), then hand it over. Used when the screen that knows what to
  do is not mounted yet — e.g. ⌘N outside a brain navigates to the brain and
  defers "new-note" to the workspace that is about to mount, or a .md file
  double-clicked before sign-in waits for the import handler.
*/

export type StackHandler<E> = (e: E) => void | boolean | Promise<void>;

export class HandlerStack<K extends string, E> {
  private stacks = new Map<K, { id: number; fn: StackHandler<E> }[]>();
  private pending = new Map<K, { event: E; until: number }[]>();
  private nextId = 1;

  register(key: K, fn: StackHandler<E>): () => void {
    const id = this.nextId++;
    const stack = this.stacks.get(key) ?? [];
    stack.push({ id, fn });
    this.stacks.set(key, stack);

    const parked = (this.pending.get(key) ?? []).filter((p) => p.until > Date.now());
    this.pending.delete(key);
    if (parked.length) {
      // After the registering effect finishes, so the handler's component is
      // fully mounted.
      setTimeout(() => {
        for (const p of parked) if (!this.dispatch(key, p.event)) this.defer(key, p.event, p.until - Date.now());
      }, 0);
    }

    return () => {
      const s = this.stacks.get(key) ?? [];
      this.stacks.set(key, s.filter((h) => h.id !== id));
    };
  }

  dispatch(key: K, event: E): boolean {
    const stack = this.stacks.get(key) ?? [];
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].fn(event) !== false) return true;
    }
    return false;
  }

  defer(key: K, event: E, ttlMs: number): void {
    if (ttlMs <= 0) return;
    const list = this.pending.get(key) ?? [];
    list.push({ event, until: Date.now() + ttlMs });
    this.pending.set(key, list);
  }
}
