export type SaveCoordinatorState =
  | { readonly status: "idle" }
  | { readonly status: "editing" }
  | { readonly status: "saving-local" }
  | { readonly status: "saved-local" }
  | { readonly status: "error"; readonly error: unknown };

export interface SaveCoordinatorOptions<Value> {
  readonly save: (value: Value) => Promise<void>;
  readonly delayMs?: number;
  readonly onStateChange?: (state: SaveCoordinatorState) => void;
}

/**
 * Debounces local writes while preserving their causal order.
 *
 * Exactly one save can run at a time. If edits arrive while it is running,
 * only the newest snapshot remains queued and it starts after the active save.
 */
export class SaveCoordinator<Value> {
  readonly #save: (value: Value) => Promise<void>;
  readonly #delayMs: number;
  readonly #onStateChange: ((state: SaveCoordinatorState) => void) | undefined;
  #state: SaveCoordinatorState = { status: "idle" };
  #pending: Value | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #active: Promise<void> | null = null;
  #disposed = false;

  constructor(options: SaveCoordinatorOptions<Value>) {
    this.#save = options.save;
    this.#delayMs = options.delayMs ?? 300;
    this.#onStateChange = options.onStateChange;
  }

  get state(): SaveCoordinatorState {
    return this.#state;
  }

  schedule(value: Value): void {
    if (this.#disposed) {
      return;
    }
    this.#pending = value;
    this.#transition({ status: "editing" });
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#drain(false);
    }, this.#delayMs);
  }

  async flush(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#drain(true);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#drain(true);
  }

  async #drain(force: boolean): Promise<void> {
    if (this.#active !== null) {
      await this.#active;
      if (force && this.#pending !== null) {
        await this.#drain(true);
      }
      return;
    }
    if (this.#pending === null || (!force && this.#timer !== null)) {
      return;
    }

    const value = this.#pending;
    this.#pending = null;
    this.#transition({ status: "saving-local" });
    const active = this.#save(value);
    this.#active = active;
    try {
      await active;
      this.#transition(this.#pending === null ? { status: "saved-local" } : { status: "editing" });
    } catch (error) {
      this.#transition({ status: "error", error });
      return;
    } finally {
      this.#active = null;
    }

    if (this.#pending !== null && (force || this.#timer === null)) {
      await this.#drain(force);
    }
  }

  #transition(state: SaveCoordinatorState): void {
    this.#state = state;
    if (!this.#disposed) {
      this.#onStateChange?.(state);
    }
  }
}
