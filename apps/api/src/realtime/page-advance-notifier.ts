/** Ephemeral post-commit signal for operational page catch-up. */

import type { Uuid } from "@myownnotion/domain";

export interface PageAdvanceEvent {
  readonly pageId: Uuid;
  readonly latestPageSequence: number;
}

export type PageAdvanceListener = (event: PageAdvanceEvent) => void;

/**
 * Fans a committed page position out to live transports.
 *
 * The event is deliberately not content and not a durable cursor. A listener
 * may miss it during a restart; every client therefore catches up from its own
 * encrypted frontier on reconnect. This object only removes the normal-case
 * polling delay.
 */
export class PageAdvanceNotifier {
  readonly #listeners = new Set<PageAdvanceListener>();

  subscribe(listener: PageAdvanceListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: PageAdvanceEvent): void {
    if (!Number.isSafeInteger(event.latestPageSequence) || event.latestPageSequence < 0) {
      throw new TypeError("the committed page sequence must be a non-negative safe integer");
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // A listener is a live socket adapter. Once it throws it can no longer
        // be trusted to receive later positions; retaining it would turn every
        // page commit into another write to a dead connection.
        this.#listeners.delete(listener);
      }
    }
  }

  get size(): number {
    return this.#listeners.size;
  }

  clear(): void {
    this.#listeners.clear();
  }
}

export const pageAdvanceNotifier = new PageAdvanceNotifier();
