/** Bounded, content-free diagnostics for the realtime page-sync transport. */

import { type PageSyncRequestDto, REALTIME_PAGE_SYNC_CLOSE_CODES } from "@myownnotion/contracts";
import type { Uuid } from "@myownnotion/domain";
import type { FastifyBaseLogger } from "fastify";

const SYNC_MODES = ["active", "empty", "legacy-branch"] as const;
const EXCHANGE_OUTCOMES = [
  "accepted",
  "repeated",
  "caught-up",
  "checkpoint",
  "legacy-converted",
  "rejected",
  "revoked",
  "internal-error",
] as const;
const CLOSE_CATEGORIES = [
  "normal",
  "shutdown",
  "timeout",
  "authorization",
  "protocol",
  "limited",
  "internal",
  "transport",
] as const;
export const REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS = [
  10,
  50,
  100,
  250,
  500,
  1_000,
  2_000,
  5_000,
  15_000,
  30_000,
  Number.POSITIVE_INFINITY,
] as const;

export type RealtimePageSyncMode = (typeof SYNC_MODES)[number];
export type RealtimePageSyncExchangeOutcome = (typeof EXCHANGE_OUTCOMES)[number];
export type RealtimePageSyncCloseCategory = (typeof CLOSE_CATEGORIES)[number];

type SafeLogger = Pick<FastifyBaseLogger, "debug" | "info">;

export interface RealtimePageSyncExchangeHandle {
  finish(input: {
    readonly outcome: RealtimePageSyncExchangeOutcome;
    readonly safeCode?: string;
  }): void;
}

export interface RealtimePageSyncObserver {
  sessionOpened(input: { readonly connectionId: Uuid; readonly deviceId: string }): void;
  sessionReady(input: { readonly connectionId: Uuid; readonly deviceId: string }): void;
  sessionClosed(input: {
    readonly connectionId: Uuid;
    readonly deviceId: string;
    readonly code: number;
  }): void;
  beginExchange(input: {
    readonly connectionId: Uuid;
    readonly deviceId: string;
    readonly requestId: Uuid;
    readonly mode: RealtimePageSyncMode;
    readonly batchSize: number;
  }): RealtimePageSyncExchangeHandle;
}

export interface RealtimePageSyncMetricsSnapshot {
  readonly activeSessions: number;
  readonly activeExchanges: number;
  readonly sessionsOpened: number;
  readonly sessionsReady: number;
  readonly sessionsClosed: number;
  readonly closesByCategory: Readonly<Record<RealtimePageSyncCloseCategory, number>>;
  readonly exchangesByMode: Readonly<Record<RealtimePageSyncMode, number>>;
  readonly exchangesByOutcome: Readonly<Record<RealtimePageSyncExchangeOutcome, number>>;
  /** Cumulative buckets; the final `null` upper bound represents +Infinity. */
  readonly exchangeLatency: readonly {
    readonly upperBoundMs: number | null;
    readonly count: number;
  }[];
}

function zeroRecord<const T extends readonly string[]>(keys: T): Record<T[number], number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T[number], number>;
}

function closeCategory(code: number): RealtimePageSyncCloseCategory {
  if (code === 1000) return "normal";
  if (code === 1001) return "shutdown";
  if (code === REALTIME_PAGE_SYNC_CLOSE_CODES.timeout) return "timeout";
  if (
    code === REALTIME_PAGE_SYNC_CLOSE_CODES.authenticationRequired ||
    code === REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused
  ) {
    return "authorization";
  }
  if (code === REALTIME_PAGE_SYNC_CLOSE_CODES.rateLimited) return "limited";
  if (code === REALTIME_PAGE_SYNC_CLOSE_CODES.internalError) return "internal";
  if (
    code === REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage ||
    code === REALTIME_PAGE_SYNC_CLOSE_CODES.updateRequired ||
    code === REALTIME_PAGE_SYNC_CLOSE_CODES.duplicateInFlight
  ) {
    return "protocol";
  }
  return "transport";
}

function diagnosticCode(code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (code.includes("revoked")) return "realtime.sync.revoked";
  if (code.includes("digest") || code.includes("integrity") || code.includes("projection")) {
    return "realtime.sync.integrity";
  }
  if (code.includes("schema") || code.includes("protocol") || code.includes("version")) {
    return "realtime.sync.protocol";
  }
  if (code.includes("not-found")) return "realtime.sync.not-found";
  if (code.includes("stale") || code.includes("ambiguity") || code.includes("conflict")) {
    return "realtime.sync.conflict";
  }
  if (code.includes("storage") || code.includes("database")) return "realtime.sync.storage";
  if (code.includes("validation") || code.includes("dependencies")) {
    return "realtime.sync.validation";
  }
  // Never put an arbitrary service string into a log. Unknown codes collapse
  // to one diagnostic category even when a future caller accidentally builds
  // a code from owner content.
  return "realtime.sync.rejected";
}

export function realtimePageSyncBatchSize(request: PageSyncRequestDto): number {
  if (request.mode === "active") return request.updates.length;
  if (request.mode === "legacy-branch") return request.semanticTransactions.length;
  return 0;
}

/**
 * Process-local counters intentionally use only finite label sets. Identifiers
 * are emitted to structured logs for correlation but are never metric labels,
 * and no API accepts page text, update bytes, vectors, ciphertext or secrets.
 */
export class RealtimePageSyncObservability implements RealtimePageSyncObserver {
  readonly #logger: SafeLogger;
  readonly #now: () => number;
  readonly #closesByCategory = zeroRecord(CLOSE_CATEGORIES);
  readonly #exchangesByMode = zeroRecord(SYNC_MODES);
  readonly #exchangesByOutcome = zeroRecord(EXCHANGE_OUTCOMES);
  readonly #exchangeLatency = REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS.map(() => 0);
  #activeSessions = 0;
  #activeExchanges = 0;
  #sessionsOpened = 0;
  #sessionsReady = 0;
  #sessionsClosed = 0;

  constructor(logger: SafeLogger, options: { readonly now?: () => number } = {}) {
    this.#logger = logger;
    this.#now = options.now ?? Date.now;
  }

  sessionOpened(input: { readonly connectionId: Uuid; readonly deviceId: string }): void {
    this.#activeSessions += 1;
    this.#sessionsOpened += 1;
    this.#logger.info(
      {
        realtimeSync: {
          event: "session-opened",
          connectionId: input.connectionId,
          deviceId: input.deviceId,
        },
      },
      "realtime page-sync session opened",
    );
  }

  sessionReady(input: { readonly connectionId: Uuid; readonly deviceId: string }): void {
    this.#sessionsReady += 1;
    this.#logger.info(
      {
        realtimeSync: {
          event: "session-ready",
          connectionId: input.connectionId,
          deviceId: input.deviceId,
        },
      },
      "realtime page-sync session ready",
    );
  }

  sessionClosed(input: {
    readonly connectionId: Uuid;
    readonly deviceId: string;
    readonly code: number;
  }): void {
    const category = closeCategory(input.code);
    this.#activeSessions = Math.max(0, this.#activeSessions - 1);
    this.#sessionsClosed += 1;
    this.#closesByCategory[category] += 1;
    this.#logger.info(
      {
        realtimeSync: {
          event: "session-closed",
          connectionId: input.connectionId,
          deviceId: input.deviceId,
          closeCode: input.code,
          closeCategory: category,
        },
      },
      "realtime page-sync session closed",
    );
  }

  beginExchange(input: {
    readonly connectionId: Uuid;
    readonly deviceId: string;
    readonly requestId: Uuid;
    readonly mode: RealtimePageSyncMode;
    readonly batchSize: number;
  }): RealtimePageSyncExchangeHandle {
    const startedAt = this.#now();
    this.#activeExchanges += 1;
    this.#exchangesByMode[input.mode] += 1;
    let finished = false;
    return {
      finish: ({ outcome, safeCode }) => {
        if (finished) return;
        finished = true;
        const durationMs = Math.max(0, Math.round(this.#now() - startedAt));
        this.#activeExchanges = Math.max(0, this.#activeExchanges - 1);
        this.#exchangesByOutcome[outcome] += 1;
        for (let index = 0; index < REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS.length; index += 1) {
          const upperBoundMs = REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS[index];
          if (upperBoundMs !== undefined && durationMs <= upperBoundMs) {
            this.#exchangeLatency[index] = (this.#exchangeLatency[index] ?? 0) + 1;
          }
        }
        const code = diagnosticCode(safeCode);
        this.#logger.debug(
          {
            realtimeSync: {
              event: "exchange-completed",
              connectionId: input.connectionId,
              deviceId: input.deviceId,
              requestId: input.requestId,
              mode: input.mode,
              batchSize: Math.max(0, Math.trunc(input.batchSize)),
              durationMs,
              outcome,
              ...(code === undefined ? {} : { safeCode: code }),
            },
          },
          "realtime page-sync exchange completed",
        );
      },
    };
  }

  snapshot(): RealtimePageSyncMetricsSnapshot {
    return {
      activeSessions: this.#activeSessions,
      activeExchanges: this.#activeExchanges,
      sessionsOpened: this.#sessionsOpened,
      sessionsReady: this.#sessionsReady,
      sessionsClosed: this.#sessionsClosed,
      closesByCategory: { ...this.#closesByCategory },
      exchangesByMode: { ...this.#exchangesByMode },
      exchangesByOutcome: { ...this.#exchangesByOutcome },
      exchangeLatency: REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS.map((upperBoundMs, index) => ({
        upperBoundMs: Number.isFinite(upperBoundMs) ? upperBoundMs : null,
        count: this.#exchangeLatency[index] ?? 0,
      })),
    };
  }
}
