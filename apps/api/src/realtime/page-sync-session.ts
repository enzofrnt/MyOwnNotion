/** Bounded server-side state machine for one page-sync WebSocket. */

import {
  MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  type PageSyncRequestDto,
  type PageSyncResponseDto,
  parseRealtimePageSyncClientFrame,
  REALTIME_PAGE_SYNC_CLOSE_CODES,
  REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS,
  REALTIME_PAGE_SYNC_HELLO_TIMEOUT_MS,
  REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
  REALTIME_PAGE_SYNC_REQUEST_TIMEOUT_MS,
  type RealtimePageSyncClientMessageDto,
  type RealtimePageSyncServerMessageDto,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { RawData, WebSocket } from "ws";
import { PageOperationServiceError } from "../page-state/page-operation-errors.ts";
import type { RealtimeAuthorizationDecision } from "../security/realtime-authorization.ts";
import type { RequestPrincipal } from "../security/request-context.ts";
import type { PageAdvanceEvent } from "./page-advance-notifier.ts";
import type { PageSyncHub } from "./page-sync-hub.ts";
import { PageSyncLimits } from "./page-sync-limits.ts";
import {
  type RealtimePageSyncExchangeOutcome,
  type RealtimePageSyncObserver,
  realtimePageSyncBatchSize,
} from "./page-sync-observability.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;
type SessionState = "awaiting-hello" | "ready" | "closing" | "closed";

export interface PageSyncSessionDeps {
  readonly socket: WebSocket;
  readonly principal: OwnerPrincipal;
  readonly hub: PageSyncHub;
  readonly authorizeHello: (csrfToken: string) => Promise<RealtimeAuthorizationDecision>;
  readonly reauthorizeDevice: () => Promise<boolean>;
  readonly synchronize: (input: {
    readonly pageId: Uuid;
    readonly ownerId: string;
    readonly deviceId: Uuid;
    readonly request: PageSyncRequestDto;
  }) => Promise<PageSyncResponseDto>;
  readonly observability?: RealtimePageSyncObserver;
  readonly createConnectionId?: () => Uuid;
  readonly now?: () => number;
}

function looksLikeVersionMismatch(frame: string): boolean {
  try {
    const value = JSON.parse(frame) as Record<string, unknown>;
    return (
      value["type"] === "hello" &&
      (value["realtimeProtocolVersion"] !== REALTIME_PAGE_SYNC_PROTOCOL_VERSION ||
        value["pageOperationProtocolVersion"] !== PAGE_OPERATION_PROTOCOL_VERSION)
    );
  } catch {
    return false;
  }
}

export class PageSyncSession {
  readonly connectionId: Uuid;
  readonly ownerId: string;
  readonly deviceId: string;
  readonly #deps: PageSyncSessionDeps;
  readonly #limits: PageSyncLimits;
  readonly #now: () => number;
  #state: SessionState = "awaiting-hello";
  #helloPending = false;
  #lastSeenAt: number;
  #helloTimer: NodeJS.Timeout | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #heartbeatRunning = false;
  #closureObserved = false;

  constructor(deps: PageSyncSessionDeps) {
    this.#deps = deps;
    this.connectionId = (deps.createConnectionId ?? generateUuidV7)();
    this.ownerId = deps.principal.ownerId;
    this.deviceId = deps.principal.deviceId;
    this.#now = deps.now ?? Date.now;
    this.#limits = new PageSyncLimits(this.#now);
    this.#lastSeenAt = this.#now();

    // Attach synchronously: a browser may send hello immediately after upgrade.
    deps.socket.on("message", (frame: RawData, isBinary: boolean) => {
      if (isBinary) {
        this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage, "text-frames-only");
        return;
      }
      void this.#receive(frame.toString());
    });
    deps.socket.once("close", (code) => this.#dispose(code));
    deps.socket.once("error", () => this.#dispose(1006));

    deps.observability?.sessionOpened({
      connectionId: this.connectionId,
      deviceId: this.deviceId,
    });

    this.#helloTimer = setTimeout(() => {
      this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.timeout, "hello-timeout");
    }, REALTIME_PAGE_SYNC_HELLO_TIMEOUT_MS);
    this.#helloTimer.unref();
  }

  get state(): SessionState {
    return this.#state;
  }

  async #receive(frame: string): Promise<void> {
    if (this.#state === "closing" || this.#state === "closed") return;
    const frameAdmission = this.#limits.admitFrame(frame);
    if (!frameAdmission.allowed) {
      this.#close(
        frameAdmission.reason === "message-too-large"
          ? REALTIME_PAGE_SYNC_CLOSE_CODES.messageTooLarge
          : REALTIME_PAGE_SYNC_CLOSE_CODES.rateLimited,
        frameAdmission.reason,
      );
      return;
    }
    let message: RealtimePageSyncClientMessageDto;
    try {
      message = parseRealtimePageSyncClientFrame(frame);
    } catch {
      this.#close(
        looksLikeVersionMismatch(frame)
          ? REALTIME_PAGE_SYNC_CLOSE_CODES.updateRequired
          : REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage,
        looksLikeVersionMismatch(frame) ? "update-required" : "invalid-message",
      );
      return;
    }
    this.#lastSeenAt = this.#now();

    if (this.#state === "awaiting-hello") {
      if (message.type !== "hello" || this.#helloPending) {
        this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage, "hello-required");
        return;
      }
      this.#helloPending = true;
      const decision = await this.#deps.authorizeHello(message.csrfToken);
      if (this.#state !== "awaiting-hello") return;
      if (!decision.allowed) {
        this.#send({
          type: "refused",
          requestId: message.requestId as Uuid,
          code: decision.code,
          message: decision.message,
        });
        this.#close(
          decision.code === "authentication_required"
            ? REALTIME_PAGE_SYNC_CLOSE_CODES.authenticationRequired
            : REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused,
          decision.code,
        );
        return;
      }
      this.#state = "ready";
      if (this.#helloTimer !== null) clearTimeout(this.#helloTimer);
      this.#helloTimer = null;
      this.#deps.hub.add(this);
      this.#deps.observability?.sessionReady({
        connectionId: this.connectionId,
        deviceId: this.deviceId,
      });
      this.#send({
        type: "ready",
        requestId: message.requestId as Uuid,
        connectionId: this.connectionId,
        realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
        pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
        heartbeatIntervalMs: REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS,
        requestTimeoutMs: REALTIME_PAGE_SYNC_REQUEST_TIMEOUT_MS,
        maxMessageBytes: MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
        maxInFlight: MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
      });
      this.#startHeartbeat();
      return;
    }

    if (message.type === "hello") {
      this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.invalidMessage, "duplicate-hello");
      return;
    }
    if (message.type === "ping") {
      this.#send({ type: "pong", nonce: message.nonce });
      return;
    }
    if (message.type === "pong") return;
    await this.#synchronize(message.pageId as Uuid, message.requestId as Uuid, message.request);
  }

  async #synchronize(pageId: Uuid, requestId: Uuid, request: PageSyncRequestDto): Promise<void> {
    const admission = this.#limits.admitExchange(requestId, pageId);
    if (!admission.allowed) {
      const rateLimited = admission.reason === "too-many-in-flight";
      this.#send({
        type: "sync-problem",
        requestId,
        pageId,
        offline: false,
        retryable: true,
        retryAfterMs: 50,
        problem: {
          code: rateLimited ? "realtime.rate-limited" : "realtime.duplicate-in-flight",
          message: "A synchronization exchange is already in progress.",
        },
      });
      this.#close(
        rateLimited
          ? REALTIME_PAGE_SYNC_CLOSE_CODES.rateLimited
          : REALTIME_PAGE_SYNC_CLOSE_CODES.duplicateInFlight,
        admission.reason,
      );
      return;
    }
    const exchange = this.#deps.observability?.beginExchange({
      connectionId: this.connectionId,
      deviceId: this.deviceId,
      requestId,
      mode: request.mode,
      batchSize: realtimePageSyncBatchSize(request),
    });
    let outcome: RealtimePageSyncExchangeOutcome = "internal-error";
    let safeCode: string | undefined;
    try {
      if (!(await this.#deps.reauthorizeDevice())) {
        outcome = "revoked";
        safeCode = "page-operations.device-revoked";
        this.#send({
          type: "sync-problem",
          requestId,
          pageId,
          offline: false,
          retryable: false,
          problem: {
            code: "page-operations.device-revoked",
            message: "This device is no longer authorized.",
          },
        });
        this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused, "device-revoked");
        return;
      }
      const response = await this.#deps.synchronize({
        pageId,
        ownerId: this.ownerId,
        deviceId: this.deviceId as Uuid,
        request,
      });
      outcome =
        response.mode === "active"
          ? response.accepted.length > 0
            ? "accepted"
            : response.repeated.length > 0
              ? "repeated"
              : "caught-up"
          : "convertedBranchId" in response
            ? "legacy-converted"
            : "checkpoint";
      this.#send({ type: "sync-result", requestId, pageId, response });
    } catch (error) {
      if (error instanceof PageOperationServiceError) {
        outcome = "rejected";
        safeCode = error.code;
        this.#send({
          type: "sync-problem",
          requestId,
          pageId,
          offline: false,
          retryable: error.status >= 500,
          problem: { code: error.code, message: error.message },
        });
        if (error.code === "page-operations.device-revoked") {
          this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused, "device-revoked");
        }
      } else {
        outcome = "internal-error";
        safeCode = "realtime.internal-error";
        this.#send({
          type: "sync-problem",
          requestId,
          pageId,
          offline: false,
          retryable: true,
          problem: {
            code: "realtime.internal-error",
            message: "Synchronization could not be completed.",
          },
        });
        this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.internalError, "internal-error");
      }
    } finally {
      exchange?.finish({ outcome, ...(safeCode === undefined ? {} : { safeCode }) });
      this.#limits.releaseExchange(requestId, pageId);
    }
  }

  #startHeartbeat(): void {
    this.#heartbeatTimer = setInterval(
      () => void this.#heartbeat(),
      REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS,
    );
    this.#heartbeatTimer.unref();
  }

  async #heartbeat(): Promise<void> {
    if (this.#state !== "ready" || this.#heartbeatRunning) return;
    if (this.#now() - this.#lastSeenAt >= REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS) {
      this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.timeout, "liveness-timeout");
      return;
    }
    this.#heartbeatRunning = true;
    try {
      if (!(await this.#deps.reauthorizeDevice())) {
        this.#close(REALTIME_PAGE_SYNC_CLOSE_CODES.authorizationRefused, "device-revoked");
        return;
      }
      this.#send({ type: "ping", nonce: generateUuidV7() });
    } finally {
      this.#heartbeatRunning = false;
    }
  }

  sendPageAdvance(event: PageAdvanceEvent): boolean {
    if (this.#state !== "ready") return false;
    return this.#send({ type: "page-advanced", ...event });
  }

  close(code: number, reason: string): void {
    this.#close(code, reason);
  }

  #send(message: RealtimePageSyncServerMessageDto): boolean {
    if (this.#deps.socket.readyState !== 1) return false;
    try {
      this.#deps.socket.send(JSON.stringify(message));
      return true;
    } catch {
      this.#dispose();
      return false;
    }
  }

  #close(code: number, reason: string): void {
    if (this.#state === "closing" || this.#state === "closed") return;
    this.#state = "closing";
    this.#deps.hub.remove(this.connectionId);
    if (this.#helloTimer !== null) clearTimeout(this.#helloTimer);
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    this.#helloTimer = null;
    this.#heartbeatTimer = null;
    this.#observeClosed(code);
    try {
      this.#deps.socket.close(code, reason);
    } catch {
      this.#dispose(code);
    }
  }

  #dispose(code = 1006): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#deps.hub.remove(this.connectionId);
    if (this.#helloTimer !== null) clearTimeout(this.#helloTimer);
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    this.#helloTimer = null;
    this.#heartbeatTimer = null;
    this.#observeClosed(code);
  }

  #observeClosed(code: number): void {
    if (this.#closureObserved) return;
    this.#closureObserved = true;
    this.#deps.observability?.sessionClosed({
      connectionId: this.connectionId,
      deviceId: this.deviceId,
      code,
    });
  }
}
