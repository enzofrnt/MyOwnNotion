/** Native WebSocket transport over the durable protocol-v3 page reconciler. */

import type {
  PageAmbiguityTransportResult,
  PageSyncTransport,
  PageSyncTransportResult,
} from "@myownnotion/client-core";
import {
  type LegacyOfflineBranchSyncRequestDto,
  PAGE_OPERATION_PROTOCOL_VERSION,
  type PageSyncRequestDto,
  parseRealtimePageSyncServerFrame,
  REALTIME_PAGE_SYNC_CLOSE_CODES,
  REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
  REALTIME_PAGE_SYNC_REQUEST_TIMEOUT_MS,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";

export type RealtimePageSyncState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "ready"
  | "backoff"
  | "revoked"
  | "needs-update"
  | "closed";

export interface RealtimePageAdvance {
  readonly pageId: Uuid;
  readonly latestPageSequence: number;
}

export interface RealtimePageSyncTransportOptions {
  readonly baseUrl?: string;
  readonly csrfToken: () => string | null;
  readonly socketFactory?: (url: string | URL) => WebSocket;
  readonly fallback?: PageSyncTransport | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly connectWaitMs?: number | undefined;
  readonly reconnect?: boolean | undefined;
  readonly random?: () => number;
}

function configuredApiUrl(): string {
  return (
    (import.meta as ImportMeta & { readonly env?: Record<string, string | undefined> }).env?.[
      "VITE_API_URL"
    ] ?? ""
  );
}

interface PendingRequest {
  readonly pageId: Uuid;
  readonly frame: string;
  readonly resolve: (result: PageSyncTransportResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const MIN_RETRY_DELAY_MS = 50;
const MAX_RETRY_DELAY_MS = 2_000;
/** A channel that stays healthy this long has earned a fresh reconnect budget. */
const STABLE_CONNECTION_MS = 10_000;

const OFFLINE_RESULT = {
  ok: false,
  offline: true,
  problem: {
    code: "realtime.disconnected",
    message: "The live channel is unavailable; durable local changes are retained.",
  },
} as const;

function socketUrl(baseUrl: string): string {
  const fallbackOrigin =
    typeof globalThis.location?.origin === "string"
      ? globalThis.location.origin
      : "http://127.0.0.1";
  const url = new URL("/v1/page-sync/socket", baseUrl || fallbackOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export class RealtimePageSyncTransport implements PageSyncTransport {
  readonly #baseUrl: string;
  readonly #csrfToken: () => string | null;
  readonly #socketFactory: (url: string | URL) => WebSocket;
  readonly #fallback: PageSyncTransport | undefined;
  readonly #requestTimeoutOverride: number | undefined;
  readonly #connectWaitMs: number;
  readonly #reconnect: boolean;
  readonly #random: () => number;
  readonly #pending = new Map<Uuid, PendingRequest>();
  readonly #inFlightPages = new Set<Uuid>();
  readonly #stateListeners = new Set<(state: RealtimePageSyncState) => void>();
  readonly #pageAdvanceListeners = new Set<(event: RealtimePageAdvance) => void>();
  readonly #latestAnnouncements = new Map<Uuid, number>();
  readonly #queuedAnnouncements = new Map<Uuid, number>();
  readonly #readyWaiters = new Set<(ready: boolean) => void>();
  #socket: WebSocket | null = null;
  #state: RealtimePageSyncState = "idle";
  #started = false;
  #helloRequestId: Uuid | null = null;
  #serverRequestTimeoutMs = REALTIME_PAGE_SYNC_REQUEST_TIMEOUT_MS;
  #reconnectAttempt = 0;
  #readyAt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #livenessTimer: ReturnType<typeof setTimeout> | null = null;
  #lastServerFrameAt = 0;
  #announcementFlushQueued = false;
  #networkAvailable = true;

  constructor(options: RealtimePageSyncTransportOptions) {
    this.#baseUrl = (options.baseUrl ?? configuredApiUrl()).replace(/\/$/, "");
    this.#csrfToken = options.csrfToken;
    this.#socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.#fallback = options.fallback;
    this.#requestTimeoutOverride = options.requestTimeoutMs;
    this.#connectWaitMs = Math.max(0, options.connectWaitMs ?? 1_500);
    this.#reconnect = options.reconnect ?? true;
    this.#random = options.random ?? Math.random;
  }

  get state(): RealtimePageSyncState {
    return this.#state;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    if (this.#networkAvailable) this.#connect();
  }

  stop(): void {
    if (!this.#started && this.#socket === null) return;
    this.#started = false;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    if (this.#livenessTimer !== null) clearTimeout(this.#livenessTimer);
    this.#reconnectTimer = null;
    this.#livenessTimer = null;
    this.#reconnectAttempt = 0;
    this.#readyAt = 0;
    const socket = this.#socket;
    this.#socket = null;
    this.#settleReadyWaiters(false);
    this.#settlePending(OFFLINE_RESULT);
    this.#queuedAnnouncements.clear();
    this.#setState("idle");
    if (socket !== null && socket.readyState < 2) socket.close(1000, "client-disposed");
  }

  /** Accelerates recovery after `online` or a visible-tab wake-up. */
  wake(): void {
    if (!this.#networkAvailable) return;
    if (!this.#started) {
      this.start();
      return;
    }
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    if (this.#socket === null) this.#connect();
  }

  /**
   * Makes the browser's network boundary authoritative for this transport.
   *
   * Some engines keep an established WebSocket alive after switching their
   * context offline. Merely changing the page's status would then let an
   * allegedly isolated replica receive or publish operations. Detach the
   * channel synchronously and refuse exchanges until the platform announces
   * that connectivity returned.
   */
  setNetworkAvailable(available: boolean): void {
    if (this.#networkAvailable === available) return;
    this.#networkAvailable = available;
    if (available) {
      this.wake();
      return;
    }

    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    if (this.#livenessTimer !== null) clearTimeout(this.#livenessTimer);
    this.#reconnectTimer = null;
    this.#livenessTimer = null;
    this.#reconnectAttempt = 0;
    this.#readyAt = 0;
    const socket = this.#socket;
    this.#socket = null;
    this.#helloRequestId = null;
    this.#settleReadyWaiters(false);
    this.#settlePending(OFFLINE_RESULT);
    this.#queuedAnnouncements.clear();
    if (!["revoked", "needs-update", "closed"].includes(this.#state)) this.#setState("idle");
    if (socket !== null && socket.readyState < 2) socket.close(1000, "network-offline");
  }

  subscribe(listener: (state: RealtimePageSyncState) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  subscribePageAdvances(listener: (event: RealtimePageAdvance) => void): () => void {
    this.#pageAdvanceListeners.add(listener);
    return () => this.#pageAdvanceListeners.delete(listener);
  }

  async sync(pageId: Uuid, request: PageSyncRequestDto): Promise<PageSyncTransportResult> {
    return await this.#exchange(pageId, request, () => this.#fallback?.sync(pageId, request));
  }

  async convertLegacyBranch(
    pageId: Uuid,
    request: LegacyOfflineBranchSyncRequestDto,
  ): Promise<PageSyncTransportResult> {
    return await this.#exchange(pageId, request, () =>
      this.#fallback?.convertLegacyBranch(pageId, request),
    );
  }

  /**
   * Ambiguity details are protected reads, not page-state exchanges. They stay
   * on the authenticated HTTP endpoint: the socket carries only bounded sync
   * requests and content-free page-frontier announcements.
   */
  async getAmbiguity(ambiguityId: Uuid): Promise<PageAmbiguityTransportResult> {
    const getAmbiguity = this.#fallback?.getAmbiguity;
    if (getAmbiguity === undefined) {
      return {
        ok: false,
        offline: false,
        problem: {
          code: "page-operations.ambiguity-detail-unavailable",
          message: "The ambiguity detail transport is unavailable.",
        },
      };
    }
    return await getAmbiguity.call(this.#fallback, ambiguityId);
  }

  async #exchange(
    pageId: Uuid,
    request: PageSyncRequestDto,
    fallback: () => Promise<PageSyncTransportResult> | undefined,
  ): Promise<PageSyncTransportResult> {
    if (!this.#networkAvailable) return OFFLINE_RESULT;
    const ready = this.#isReady() || (await this.#awaitReady());
    if (!ready) {
      return (await fallback()) ?? OFFLINE_RESULT;
    }
    const socket = this.#socket;
    if (socket === null || socket.readyState !== 1 || this.#state !== "ready") {
      return (await fallback()) ?? OFFLINE_RESULT;
    }
    if (this.#pending.has(request.requestId as Uuid) || this.#inFlightPages.has(pageId)) {
      return {
        ok: false,
        offline: false,
        problem: {
          code: "realtime.in-flight",
          message: "A synchronization exchange is already in progress for this page.",
        },
      };
    }
    return await new Promise<PageSyncTransportResult>((resolve) => {
      const timeoutMs = this.#requestTimeoutOverride ?? this.#serverRequestTimeoutMs;
      const requestId = request.requestId as Uuid;
      const frame = JSON.stringify({ type: "sync", requestId, pageId, request });
      const timer = setTimeout(() => {
        const pending = this.#pending.get(requestId);
        if (pending === undefined) return;
        this.#settleRequest(requestId, pending, {
          ok: false,
          offline: true,
          problem: {
            code: "realtime.timeout",
            message: "The live exchange timed out; the durable update will be retried.",
          },
        });
        // A late frame from this connection cannot be correlated safely with a
        // later retry. Abandon the channel, then reconnect and catch up by ID.
        if (this.#socket !== null) {
          this.#abandonSocket(
            this.#socket,
            REALTIME_PAGE_SYNC_CLOSE_CODES.timeout,
            "request-timeout",
          );
        }
      }, timeoutMs);
      const pending: PendingRequest = {
        pageId,
        frame,
        resolve,
        timer,
        retryAttempt: 0,
        retryTimer: null,
      };
      this.#pending.set(requestId, pending);
      this.#inFlightPages.add(pageId);
      this.#sendPendingFrame(socket, requestId, pending);
    });
  }

  #connect(): void {
    if (
      !this.#started ||
      !this.#networkAvailable ||
      this.#socket !== null ||
      this.#state === "revoked" ||
      this.#state === "needs-update" ||
      this.#state === "closed"
    ) {
      return;
    }
    const csrfToken = this.#csrfToken();
    if (csrfToken === null) {
      this.#setState("idle");
      this.#settleReadyWaiters(false);
      return;
    }
    this.#setState("connecting");
    let socket: WebSocket;
    try {
      socket = this.#socketFactory(socketUrl(this.#baseUrl));
    } catch {
      this.#setState("backoff");
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.addEventListener("open", () => {
      if (this.#socket !== socket || !this.#started) return;
      this.#setState("authenticating");
      const requestId = generateUuidV7();
      this.#helloRequestId = requestId;
      const token = this.#csrfToken();
      if (token === null) {
        socket.close(REALTIME_PAGE_SYNC_CLOSE_CODES.authenticationRequired, "session-missing");
        return;
      }
      socket.send(
        JSON.stringify({
          type: "hello",
          requestId,
          realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
          pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
          csrfToken: token,
        }),
      );
    });
    socket.addEventListener("message", (event) => this.#receive(socket, event));
    socket.addEventListener("close", (event) => this.#closed(socket, event.code));
    socket.addEventListener("error", () => {
      // The close event owns retries and promise settlement. Browsers provide
      // no useful safe detail on error, so it is intentionally not surfaced.
    });
  }

  #receive(socket: WebSocket, event: MessageEvent): void {
    if (this.#socket !== socket || typeof event.data !== "string") {
      this.#abandonSocket(socket, REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage, "invalid-frame");
      return;
    }
    let message: ReturnType<typeof parseRealtimePageSyncServerFrame>;
    try {
      message = parseRealtimePageSyncServerFrame(event.data);
    } catch {
      this.#abandonSocket(socket, REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage, "invalid-frame");
      return;
    }
    this.#touchLiveness(socket);
    if (message.type === "ready") {
      if (this.#state !== "authenticating" || message.requestId !== this.#helloRequestId) {
        this.#abandonSocket(
          socket,
          REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage,
          "unexpected-ready",
        );
        return;
      }
      this.#serverRequestTimeoutMs = message.requestTimeoutMs;
      // Reaching `ready` proves authentication, not application health. A
      // deterministic page failure can arrive immediately afterwards and
      // close the socket. Resetting here turned that failure into an endless
      // 0–500 ms reconnect storm. A successful exchange (below), or a channel
      // that remains ready for a meaningful period, resets the budget.
      this.#readyAt = Date.now();
      this.#setState("ready");
      this.#touchLiveness(socket);
      this.#settleReadyWaiters(true);
      return;
    }
    if (message.type === "refused") {
      if (message.code === "device_revoked") this.#setState("revoked");
      else if (message.code.includes("protocol") || message.code.includes("update")) {
        this.#setState("needs-update");
      }
      this.#abandonSocket(
        socket,
        this.#state === "needs-update"
          ? REALTIME_PAGE_SYNC_CLOSE_CODES.updateRequired
          : REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused,
        "authorization-refused",
      );
      return;
    }
    if (message.type === "ping") {
      if (socket.readyState === 1)
        socket.send(JSON.stringify({ type: "pong", nonce: message.nonce }));
      return;
    }
    if (message.type === "pong") return;
    if (message.type === "page-advanced") {
      const pageId = message.pageId as Uuid;
      const previous = this.#latestAnnouncements.get(pageId) ?? -1;
      if (message.latestPageSequence <= previous) return;
      this.#latestAnnouncements.set(pageId, message.latestPageSequence);
      this.#queuedAnnouncements.set(pageId, message.latestPageSequence);
      this.#queueAnnouncementFlush();
      return;
    }
    const requestId = message.requestId as Uuid;
    const pending = this.#pending.get(requestId);
    if (pending === undefined || pending.pageId !== message.pageId) return;
    if (message.type === "sync-result") {
      this.#reconnectAttempt = 0;
      this.#settleRequest(requestId, pending, { ok: true, value: message.response });
      return;
    }
    if (message.retryable) {
      this.#scheduleRequestRetry(socket, requestId, pending, message.retryAfterMs);
      return;
    }
    this.#settleRequest(requestId, pending, {
      ok: false,
      offline: message.offline,
      problem: message.problem,
    });
  }

  /**
   * Replays one immutable request after an explicitly retryable server reply.
   *
   * The durable update ID makes an uncertain server commit safe to submit at
   * least once. Keeping the same correlated request alive also prevents a
   * transient transaction refusal from falling back to the 60-second safety
   * sweep while the socket itself is healthy.
   */
  #scheduleRequestRetry(
    socket: WebSocket,
    requestId: Uuid,
    pending: PendingRequest,
    retryAfterMs: number | undefined,
  ): void {
    if (pending.retryTimer !== null) return;
    const ceiling = Math.min(MIN_RETRY_DELAY_MS * 2 ** pending.retryAttempt, MAX_RETRY_DELAY_MS);
    const jittered = Math.floor(this.#random() * (ceiling + 1));
    const delay = Math.max(MIN_RETRY_DELAY_MS, retryAfterMs ?? 0, jittered);
    pending.retryAttempt += 1;
    pending.retryTimer = setTimeout(() => {
      pending.retryTimer = null;
      if (this.#pending.get(requestId) !== pending) return;
      if (this.#socket !== socket || socket.readyState !== 1 || this.#state !== "ready") {
        this.#settleRequest(requestId, pending, OFFLINE_RESULT);
        if (this.#socket === socket) this.#abandonSocket(socket, 1001, "retry-disconnected");
        return;
      }
      this.#sendPendingFrame(socket, requestId, pending);
    }, delay);
  }

  #sendPendingFrame(socket: WebSocket, requestId: Uuid, pending: PendingRequest): void {
    try {
      socket.send(pending.frame);
    } catch {
      this.#settleRequest(requestId, pending, OFFLINE_RESULT);
      if (this.#socket === socket) this.#abandonSocket(socket, 1001, "send-failed");
    }
  }

  #settleRequest(requestId: Uuid, pending: PendingRequest, result: PageSyncTransportResult): void {
    if (this.#pending.get(requestId) !== pending) return;
    clearTimeout(pending.timer);
    if (pending.retryTimer !== null) clearTimeout(pending.retryTimer);
    pending.retryTimer = null;
    this.#pending.delete(requestId);
    this.#inFlightPages.delete(pending.pageId);
    pending.resolve(result);
  }

  #abandonSocket(socket: WebSocket, code: number, reason: string): void {
    if (this.#socket !== socket) return;
    try {
      if (socket.readyState < 2) socket.close(code, reason);
    } finally {
      // A half-open browser socket may stay in CLOSING without emitting an
      // event. Detach it immediately; its late close event is ignored by
      // identity while a fresh transport catches up by immutable update IDs.
      if (this.#socket === socket) this.#closed(socket, code);
    }
  }

  #closed(socket: WebSocket, code: number): void {
    if (this.#socket !== socket) return;
    if (this.#readyAt > 0 && Date.now() - this.#readyAt >= STABLE_CONNECTION_MS) {
      this.#reconnectAttempt = 0;
    }
    this.#readyAt = 0;
    this.#socket = null;
    this.#helloRequestId = null;
    if (this.#livenessTimer !== null) clearTimeout(this.#livenessTimer);
    this.#livenessTimer = null;
    this.#settleReadyWaiters(false);
    this.#settlePending(OFFLINE_RESULT);
    this.#queuedAnnouncements.clear();
    if (!this.#started || this.#state === "closed") return;
    if (code === REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused) {
      this.#setState("revoked");
      return;
    }
    if (code === REALTIME_PAGE_SYNC_CLOSE_CODES.updateRequired) {
      this.#setState("needs-update");
      return;
    }
    if (!this.#reconnect) {
      this.#setState("idle");
      return;
    }
    this.#setState("backoff");
    this.#scheduleReconnect();
  }

  #touchLiveness(socket: WebSocket): void {
    if (this.#socket !== socket) return;
    this.#lastServerFrameAt = Date.now();
    if (this.#state !== "ready") return;
    this.#scheduleLivenessCheck(socket, REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS);
  }

  #scheduleLivenessCheck(socket: WebSocket, delayMs: number): void {
    if (this.#livenessTimer !== null) clearTimeout(this.#livenessTimer);
    this.#livenessTimer = setTimeout(() => {
      if (this.#socket !== socket || this.#state !== "ready") return;
      const elapsed = Date.now() - this.#lastServerFrameAt;
      if (elapsed < REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS) {
        // Timers may fire early after a suspended tab or a wall-clock
        // adjustment. Reschedule only the remaining window: treating the
        // timer itself as a server frame would keep a dead socket alive.
        this.#scheduleLivenessCheck(socket, REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS - elapsed);
        return;
      }
      this.#abandonSocket(socket, REALTIME_PAGE_SYNC_CLOSE_CODES.timeout, "liveness-timeout");
    }, delayMs);
  }

  #scheduleReconnect(): void {
    if (
      !this.#started ||
      !this.#networkAvailable ||
      !this.#reconnect ||
      this.#reconnectTimer !== null
    ) {
      return;
    }
    const ceiling = Math.min(500 * 2 ** this.#reconnectAttempt, 5_000);
    const delay = Math.floor(this.#random() * (ceiling + 1));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  /** Collapses one synchronous/network burst to its newest frontier per page. */
  #queueAnnouncementFlush(): void {
    if (this.#announcementFlushQueued) return;
    this.#announcementFlushQueued = true;
    queueMicrotask(() => {
      this.#announcementFlushQueued = false;
      if (!this.#started || this.#state !== "ready") {
        this.#queuedAnnouncements.clear();
        return;
      }
      const announcements = [...this.#queuedAnnouncements.entries()];
      this.#queuedAnnouncements.clear();
      for (const [pageId, latestPageSequence] of announcements) {
        const announcement = { pageId, latestPageSequence };
        for (const listener of [...this.#pageAdvanceListeners]) listener(announcement);
      }
    });
  }

  async #awaitReady(): Promise<boolean> {
    if (this.#isReady()) return true;
    if (!this.#networkAvailable) return false;
    if (!this.#started) this.start();
    if (this.#isReady()) return true;
    if (this.#csrfToken() === null) return false;
    if (this.#connectWaitMs === 0 || ["revoked", "needs-update", "closed"].includes(this.#state)) {
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.#readyWaiters.delete(finish);
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), this.#connectWaitMs);
      this.#readyWaiters.add(finish);
    });
  }

  #isReady(): boolean {
    return this.#state === "ready";
  }

  #settleReadyWaiters(ready: boolean): void {
    const waiters = [...this.#readyWaiters];
    this.#readyWaiters.clear();
    for (const waiter of waiters) waiter(ready);
  }

  #settlePending(result: PageSyncTransportResult): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    this.#inFlightPages.clear();
    for (const request of pending) {
      clearTimeout(request.timer);
      if (request.retryTimer !== null) clearTimeout(request.retryTimer);
      request.retryTimer = null;
      request.resolve(result);
    }
  }

  #setState(state: RealtimePageSyncState): void {
    if (this.#state === state) return;
    this.#state = state;
    for (const listener of [...this.#stateListeners]) listener(state);
  }
}
