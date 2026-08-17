/**
 * Listening for changes made on another device (T012, T018, T019 — US1, US2).
 *
 * Subscribes to `/v1/changes/stream` and, on each event, asks the existing
 * reconciliation pass to run. That is the entire mechanism, and the restraint is
 * the design:
 *
 * **The event does not carry the change, and this hook does not apply one.** It
 * hears "the feed advanced" and calls `synchronize()`, which fetches from the
 * device's *own* cursor through the path that already resolves sealed envelopes,
 * merges into the projection, and keeps the outbox. Applying a pushed payload
 * here would be a second way for content to enter this device, and the first one
 * carries protections this one would not.
 *
 * **Told about and applied are kept apart** (FR-005). `Last-Event-ID` is the
 * browser's business — `EventSource` resends it by itself on reconnect — while
 * what this device has *applied* stays where it already lives, in the local
 * cursor that `reconcile` reads and advances. The two are allowed to disagree,
 * because an event can arrive and the fetch that follows it can fail, and when
 * they disagree the cursor wins. Conflating them is precisely how an event gets
 * lost: the connection would report a position the projection never reached.
 *
 * **`compacted` needs no branch here.** The stream says the requested position
 * is too old; `synchronize()` then asks `/v1/changes`, which says the same thing,
 * and `reconcile` already rebuilds from `/v1/snapshots/current` while keeping the
 * outbox. Reaching for the snapshot from this hook would be a second rebuild path
 * that has to stay in step with the first (T019).
 */

import { useEffect, useRef, useState } from "react";
import type { LocalContentService } from "../../services/local-content.ts";

/**
 * What the owner can be told about the live connection (FR-010).
 *
 * `local` is not an error state. A device with no live connection keeps working
 * and keeps its changes; saying "disconnected" in the language of a failure
 * would misdescribe the ordinary offline-first case the product is built around.
 */
export type StreamState =
  | "connecting"
  | "live"
  | "local"
  /** The server refused this device: its access was withdrawn (FR-021). */
  | "revoked"
  /** This client is too old for this server and must be updated (FR-018). */
  | "needs-update";

/**
 * What this hook reports, and deliberately only this.
 *
 * The announced stream position used to be here too, as React state labelled
 * "for diagnostics" — and nothing ever rendered it. Every change anywhere in the
 * workspace therefore re-rendered this component and the sidebar around it, for a
 * value nobody could see. State that is never displayed is churn with no benefit,
 * and churn under somebody's cursor is a click racing a re-render.
 *
 * The device's own cursor is the authority on what it holds in any case; an
 * announced position is advisory even where it is read.
 */
export interface ChangeStreamStatus {
  readonly state: StreamState;
  /** What the server said, when it refused — shown verbatim to the owner. */
  readonly refusal: string | null;
}

/**
 * Asks the server *why* the stream will not open.
 *
 * `EventSource` reports an error and nothing else — no status, no body — which is
 * enough to say "not connected" and not enough to say "your access was
 * withdrawn" or "this device needs an update". Both of those are things an owner
 * has to be told, and neither is guessable from a failed connection.
 *
 * So a single ordinary request is made to the same URL and abandoned as soon as
 * its status is known. The response is never consumed as a stream: this is asking
 * a question, not opening a second connection.
 */
async function diagnose(
  url: string,
): Promise<{ state: StreamState; refusal: string | null } | null> {
  const abort = new AbortController();
  try {
    const response = await fetch(url, {
      headers: { accept: "text/event-stream" },
      credentials: "include",
      signal: abort.signal,
    });
    if (response.ok) {
      // Reachable after all: the EventSource error was transient. Nothing to say.
      abort.abort();
      return null;
    }
    const problem = (await response.json().catch(() => null)) as {
      code?: string;
      title?: string;
    } | null;
    if (response.status === 401 && problem?.code === "device_revoked") {
      return {
        state: "revoked",
        refusal: problem.title ?? "This device's access was withdrawn.",
      };
    }
    if (response.status === 426) {
      return {
        state: "needs-update",
        refusal: problem?.title ?? "This device needs an update before it can synchronize.",
      };
    }
    return null;
  } catch {
    // Offline, most likely. Which is the ordinary case and needs no explanation
    // beyond "keeping your changes here".
    return null;
  } finally {
    abort.abort();
  }
}

export function useChangeStream(service: LocalContentService | null): ChangeStreamStatus {
  const [state, setState] = useState<StreamState>("connecting");
  const [refusal, setRefusal] = useState<string | null>(null);

  // Held in a ref so the effect below does not depend on it. Depending on the
  // service would reopen the stream whenever the caller re-rendered with a new
  // object, and reopening a stream discards the position it was holding.
  const serviceRef = useRef(service);
  serviceRef.current = service;

  useEffect(() => {
    if (service === null) {
      return;
    }
    // Reading the URL once: the effect must not re-run because a method
    // identity changed between renders.
    const url = service.api.changeStreamUrl();

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;
    let syncRetry: ReturnType<typeof setTimeout> | null = null;
    let syncAttempt = 0;

    /**
     * Fetches what an announcement referred to, and keeps trying until it works.
     *
     * This retry is the whole of FR-005 on the client side. A notification can
     * arrive over a stream that is still open while the *fetches* fail — a stream
     * established before a network went away survives it, so a device can be told
     * about a change and be unable to read it. Without a retry, that change is
     * never asked for again: the announcement was consumed, the fetch failed, and
     * the next announcement only comes when somebody else writes something.
     *
     * That is precisely how "told about" and "applied" diverge permanently, and
     * it is why the device's own cursor — not the last id the stream delivered —
     * is the authority on what it holds.
     */
    const pursue = (): void => {
      if (stopped) {
        return;
      }
      if (syncRetry !== null) {
        clearTimeout(syncRetry);
        syncRetry = null;
      }
      void serviceRef.current?.synchronize().then(() => {
        if (stopped) {
          return;
        }
        // The state *now*, not the value that pass resolved with. Passes are
        // coalesced: a caller arriving while one is running joins it and receives
        // the state of the pass it joined, which can predate the announcement that
        // prompted this call. A pass that began before the connection dropped
        // resolves as "synced", and reading that would end the retry chain during
        // an outage — leaving the device to wait for somebody else to write
        // something before it ever tried again.
        //
        // This is the same trap as conflating "told about" with "applied", one
        // level up: the answer has to come from the current state rather than from
        // the reply to a question asked earlier.
        const state = serviceRef.current?.getSnapshot().syncState ?? "offline";
        if (state !== "offline") {
          syncAttempt = 0;
          return;
        }
        // Still unreachable. Backed off, but to a low ceiling: this is the delay
        // an owner waits *after their connection comes back* before their other
        // devices' work appears, and a long one is indefensible. Half a minute of
        // staring at a stale page because the last attempt happened to land at
        // the start of a long sleep is worse than the handful of cheap failed
        // requests a five-second ceiling costs during the outage itself.
        syncAttempt += 1;
        syncRetry = setTimeout(pursue, Math.min(1_000 * 2 ** (syncAttempt - 1), 5_000));
      });
    };

    const onAdvanced = () => {
      setState("live");
      // Not awaited: `synchronize()` coalesces concurrent callers, so a burst of
      // events becomes one pass plus at most one follow-up.
      pursue();
    };

    /**
     * Opens the stream, and reopens it when the browser gives up on it.
     *
     * `EventSource` retries on its own for the failures it considers transient,
     * and *closes permanently* for the ones it does not — a connection refused
     * because the server is down is one of those. Relying on its retry alone
     * therefore leaves a device that went offline permanently silent afterwards,
     * which is the opposite of FR-004: it would come back only when someone
     * reloaded the page. So a closed stream is reopened here.
     *
     * The delay grows to a ceiling. A device whose server is down for an hour
     * must not spend that hour asking every second, and a fixed short interval is
     * indistinguishable from a busy loop against a machine that is trying to
     * start up.
     */
    const connect = (): void => {
      if (stopped) {
        return;
      }
      try {
        source = new EventSource(url, { withCredentials: true });
      } catch {
        // A browser without EventSource, or a URL it refuses. The workspace still
        // works — it is the live part that is unavailable — so this reports the
        // local state rather than throwing into the render tree.
        setState("local");
        return;
      }
      const opened = source;

      opened.addEventListener("advanced", onAdvanced as EventListener);
      // Same handler: a compacted position means "reconcile, you are too far
      // behind to be sent events", and reconciliation is what discovers the
      // rebuild is needed. One handler rather than two also means the rebuild
      // decision is made in exactly one place.
      opened.addEventListener("compacted", onAdvanced as EventListener);
      opened.onopen = () => {
        attempt = 0;
        setState("live");
        setRefusal(null);
      };
      opened.onerror = () => {
        // `EventSource` reports an error for a dropped connection *and* while
        // reconnecting, so this is not necessarily terminal. It is reported as
        // "keeping changes here" either way, which is true in both cases and is
        // what the owner needs to know.
        const closed = opened.readyState === EventSource.CLOSED;
        setState(closed ? "local" : "connecting");
        if (!closed) {
          // The browser is retrying by itself; adding a second attempt beside it
          // would open two streams.
          return;
        }
        opened.close();
        // Asked properly, before deciding to retry. A revoked device would
        // otherwise reconnect forever against a server that refuses it, and sit
        // on "keeping your changes here" — technically true, and the least
        // useful true thing to say.
        void diagnose(url).then((diagnosis) => {
          if (stopped) {
            return;
          }
          if (diagnosis !== null) {
            // A refusal that will not change on its own. Retrying it is a
            // request that cannot succeed.
            setState(diagnosis.state);
            setRefusal(diagnosis.refusal);
            return;
          }
          attempt += 1;
          // Capped near `EventSource`'s own retry cadence. A longer ceiling
          // would make this reconnection slower than the one the browser
          // performs for itself, which is the opposite of why it exists.
          const delay = Math.min(1_000 * 2 ** (attempt - 1), 10_000);
          retry = setTimeout(connect, delay);
        });
      };
    };

    connect();

    /**
     * The browser saying the network is back.
     *
     * Both backoffs exist for an outage whose end nobody can predict — but this
     * is the browser predicting it. Sleeping through a signal the platform just
     * handed us would leave an owner watching a stale page for seconds after
     * their connection visibly returned, which is the one moment they are most
     * likely to be looking.
     */
    const onOnline = (): void => {
      if (stopped) {
        return;
      }
      attempt = 0;
      syncAttempt = 0;
      if (retry !== null) {
        clearTimeout(retry);
        retry = null;
      }
      if (source === null || source.readyState === EventSource.CLOSED) {
        connect();
      }
      pursue();
    };
    window.addEventListener("online", onOnline);

    return () => {
      stopped = true;
      window.removeEventListener("online", onOnline);
      if (retry !== null) {
        clearTimeout(retry);
      }
      if (syncRetry !== null) {
        clearTimeout(syncRetry);
      }
      source?.close();
    };
    // `service` alone: the stream is opened once per service instance. Adding
    // anything that changes per render would close and reopen the connection,
    // and a reopened stream is a device that briefly hears nothing.
  }, [service]);

  return { state, refusal };
}
