/**
 * Telling open streams that the feed advanced (T006, FR-001).
 *
 * In-process and deliberately so. This product is one server for one owner, so
 * a message bus would be infrastructure to run, monitor and secure in order to
 * deliver a notification between two objects in the same heap. If the day comes
 * that several API processes serve one workspace, this is the seam to replace —
 * and until then a `Set` is the honest implementation.
 *
 * Three properties matter, and all three are about failure rather than the happy
 * path:
 *
 * 1. **A dead subscriber must not be written to forever.** A closed connection
 *    that stays registered is a slow leak, and one that throws on write would
 *    take the publisher down with it.
 * 2. **One slow subscriber must not delay another.** Delivery is a loop, so a
 *    subscriber that blocks is a subscriber that decides when the others hear.
 * 3. **A notification is never the content.** It carries the cursor, so a
 *    device fetches through the path that resolves sealed envelopes and checks
 *    the protocol version. Pushing content here would build a second content
 *    path with none of those protections — the defect feature 005 found in the
 *    batch route.
 */

export type CursorListener = (cursor: string) => void;

export class ChangeNotifier {
  readonly #listeners = new Set<CursorListener>();

  /** Registers a listener; the returned function removes it. */
  subscribe(listener: CursorListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Tells every listener the feed reached `cursor`.
   *
   * A listener that throws is removed rather than retried. It has already failed
   * once for a reason this class cannot see — a closed socket, a client that
   * went away — and calling it again on the next change would fail identically
   * while delaying everyone behind it in the loop.
   */
  publish(cursor: string): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(cursor);
      } catch {
        this.#listeners.delete(listener);
      }
    }
  }

  /** How many streams are open, for diagnostics and tests. */
  get size(): number {
    return this.#listeners.size;
  }

  /** Drops every listener, for shutdown. */
  clear(): void {
    this.#listeners.clear();
  }
}

/**
 * The notifier the running server uses.
 *
 * A module-level instance rather than something threaded through every
 * repository call. The alternative was passing it into `submitMutation` and from
 * there into every execute function, which would put a transport concern into
 * the signature of every domain write — and the change feed is the only thing
 * that publishes, so exactly one place reaches for this.
 */
export const changeNotifier = new ChangeNotifier();

/**
 * Announces a committed feed position, if there is one.
 *
 * The three write paths — a single command, an offline batch, a finished upload —
 * all end by calling this, and all call it *after* their transaction returned.
 * That ordering is the whole point: a notification sent from inside the
 * transaction tells a device to read a position the database has not reached, the
 * read comes back empty, the device concludes it is current, and the change it
 * was told about is one it will never ask for again.
 *
 * `undefined` means nothing was appended — a replay, a rejection. Announcing an
 * unmoved position would make every retry look like a change to every connected
 * device, and a device woken to fetch nothing is the cost of a live stream paid
 * for no benefit.
 */
export function announceCommitted(sequence: number | undefined): void {
  if (sequence === undefined) {
    return;
  }
  changeNotifier.publish(String(sequence));
}
