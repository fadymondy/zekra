/*
Autosave for the note screen (MH-368), kept free of React so its ordering
rules are unit-tested:

  - a save starts `delay` ms after the LAST change (web uses 800ms);
  - at most one save is in flight; changes made during it are saved right
    after it, with the latest snapshot (never an older one);
  - flush() (blur, background, leaving the screen) saves now and resolves once
    everything typed so far is saved or has failed;
  - a 409 conflict STOPS autosaving — overwriting someone else's edit silently
    is the failure mode this exists to prevent — until the screen resolves it
    (reload theirs / overwrite) and calls resolved();
  - an error keeps the text dirty, so the next change or flush retries.
*/

export type SaveOutcome =
  | { ok: true; skipped?: boolean }
  | { ok: false; conflict: boolean; error: string };

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface AutosaveOptions<S> {
  delay: number;
  save: (snapshot: S) => Promise<SaveOutcome>;
  onStatus?: (status: AutosaveStatus, error: string) => void;
  timers?: Timers;
}

export class Autosaver<S> {
  private latest: S | null = null;
  private dirty = false;
  private conflict = false;
  private timer: unknown = null;
  private inflight: Promise<void> | null = null;
  private disposed = false;
  status: AutosaveStatus = "idle";
  lastError = "";

  private readonly opts: AutosaveOptions<S>;

  constructor(opts: AutosaveOptions<S>) {
    this.opts = opts;
  }

  private get timers(): Timers {
    return this.opts.timers ?? realTimers;
  }

  private setStatus(status: AutosaveStatus, error = "") {
    this.status = status;
    this.lastError = error;
    if (!this.disposed) this.opts.onStatus?.(status, error);
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  get inConflict(): boolean {
    return this.conflict;
  }

  change(snapshot: S): void {
    this.latest = snapshot;
    this.dirty = true;
    if (this.conflict) {
      this.setStatus("conflict", this.lastError);
      return;
    }
    if (!this.inflight) this.setStatus("dirty");
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.run();
    }, this.opts.delay);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private run(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (this.disposed || !this.dirty || this.conflict || this.latest === null) return Promise.resolve();
    const snapshot = this.latest;
    this.dirty = false;
    this.setStatus("saving");
    this.inflight = (async () => {
      let outcome: SaveOutcome;
      try {
        outcome = await this.opts.save(snapshot);
      } catch (e) {
        outcome = { ok: false, conflict: false, error: e instanceof Error ? e.message : String(e) };
      }
      this.inflight = null;
      if (outcome.ok) {
        if (this.dirty) {
          // Typed during the save: go again with the newest text.
          this.setStatus("dirty");
          if (this.timer === null) await this.run();
        } else {
          this.setStatus(outcome.skipped ? "idle" : "saved");
        }
      } else if (outcome.conflict) {
        this.dirty = true;
        this.conflict = true;
        this.cancelTimer();
        this.setStatus("conflict", outcome.error);
      } else {
        this.dirty = true;
        this.setStatus("error", outcome.error);
      }
    })();
    return this.inflight;
  }

  /** Save now; resolves when nothing typed so far is unsaved (or it failed). */
  async flush(): Promise<void> {
    this.cancelTimer();
    // Wait out a save in flight, then save whatever came after it.
    for (let i = 0; i < 3; i += 1) {
      if (this.inflight) await this.inflight;
      if (!this.dirty || this.conflict) return;
      await this.run();
      if (this.status === "error") return;
    }
  }

  /** The screen settled a conflict (reloaded or overwrote). */
  resolved(options: { dirty: boolean; snapshot?: S }): void {
    this.conflict = false;
    if (options.snapshot !== undefined) this.latest = options.snapshot;
    this.dirty = options.dirty;
    this.setStatus(options.dirty ? "dirty" : "saved");
    if (options.dirty) this.schedule();
  }

  /** Stop for good: no further saves (flush first if the text should be kept). */
  dispose(): void {
    this.cancelTimer();
    this.disposed = true;
  }
}
