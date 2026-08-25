import type { PageSyncTransport } from "@myownnotion/client-core";
import {
  type ActivePageSyncRequestDto,
  PAGE_OPERATION_PROTOCOL_VERSION,
  REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS,
  type RealtimePageSyncReadySchema,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimePageSyncTransport } from "../src/services/realtime-page-sync-transport.ts";
import { FakeWebSocketFactory } from "./support/fake-websocket.ts";

const digest = "a".repeat(64);

function request(requestId = generateUuidV7()): ActivePageSyncRequestDto {
  return {
    mode: "active",
    requestId,
    operationalVersion: 1,
    persistedVersionVector: "",
    knownServerPageSequence: 0,
    updates: [],
    maxRemoteBytes: 1_024,
  };
}

function activeResponse(pageId: Uuid, requestId: Uuid, latestPageSequence = 0) {
  return {
    mode: "active" as const,
    requestId,
    pageId,
    accepted: [],
    repeated: [],
    remoteUpdates: [],
    serverVersionVector: "",
    throughPageSequence: latestPageSequence,
    latestPageSequence,
    hasMore: false,
    canonical: {
      format: "myownnotion.document+json" as const,
      formatVersion: 3 as const,
      digest,
      lastConsolidatedRevisionId: null,
      hasUnconsolidatedChanges: false,
    },
    ambiguities: [],
    fileRequirements: [],
  };
}

function ready(requestId: Uuid) {
  return {
    type: "ready",
    requestId,
    connectionId: generateUuidV7(),
    realtimeProtocolVersion: 1,
    pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
    heartbeatIntervalMs: 20_000,
    requestTimeoutMs: 30_000,
    maxMessageBytes: 2 * 1024 * 1024,
    maxInFlight: 8,
  } satisfies typeof RealtimePageSyncReadySchema.static;
}

function openTransport(
  options: {
    fallback?: PageSyncTransport;
    requestTimeoutMs?: number;
    reconnect?: boolean;
    random?: () => number;
  } = {},
) {
  const factory = new FakeWebSocketFactory();
  const transport = new RealtimePageSyncTransport({
    baseUrl: "https://workspace.test",
    csrfToken: () => "csrf-secret",
    socketFactory: factory.create,
    fallback: options.fallback,
    requestTimeoutMs: options.requestTimeoutMs,
    reconnect: options.reconnect ?? false,
    random: options.random,
  });
  transport.start();
  const socket = factory.latest;
  socket.open();
  const hello = JSON.parse(socket.sent[0] ?? "null") as { requestId: Uuid };
  socket.serverMessage(ready(hello.requestId));
  return { factory, socket, transport };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RealtimePageSyncTransport", () => {
  it("opens one same-origin socket and keeps the CSRF token in the hello frame", () => {
    const { factory, socket, transport } = openTransport();

    expect(factory.sockets).toHaveLength(1);
    expect(socket.url).toBe("wss://workspace.test/v1/page-sync/socket");
    expect(JSON.parse(socket.sent[0] ?? "null")).toMatchObject({
      type: "hello",
      realtimeProtocolVersion: 1,
      pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
      csrfToken: "csrf-secret",
    });
    expect(transport.state).toBe("ready");
    transport.stop();
  });

  it("multiplexes pages and resolves out-of-order replies by request identity", async () => {
    const { socket, transport } = openTransport();
    const firstPage = generateUuidV7();
    const secondPage = generateUuidV7();
    const firstRequest = request();
    const secondRequest = request();

    const first = transport.sync(firstPage, firstRequest);
    const second = transport.sync(secondPage, secondRequest);
    expect(socket.sent.slice(1).map((frame) => JSON.parse(frame))).toEqual([
      { type: "sync", requestId: firstRequest.requestId, pageId: firstPage, request: firstRequest },
      {
        type: "sync",
        requestId: secondRequest.requestId,
        pageId: secondPage,
        request: secondRequest,
      },
    ]);

    socket.serverMessage({
      type: "sync-result",
      requestId: secondRequest.requestId,
      pageId: secondPage,
      response: activeResponse(secondPage, secondRequest.requestId, 2),
    });
    socket.serverMessage({
      type: "sync-result",
      requestId: firstRequest.requestId,
      pageId: firstPage,
      response: activeResponse(firstPage, firstRequest.requestId, 1),
    });

    await expect(first).resolves.toMatchObject({
      ok: true,
      value: { pageId: firstPage, latestPageSequence: 1 },
    });
    await expect(second).resolves.toMatchObject({
      ok: true,
      value: { pageId: secondPage, latestPageSequence: 2 },
    });
    transport.stop();
  });

  it("coalesces each page announcement burst to its newest frontier without treating it as content", async () => {
    const { socket, transport } = openTransport();
    const listener = vi.fn();
    const unsubscribe = transport.subscribePageAdvances(listener);
    const pageId = generateUuidV7();

    socket.serverMessage({ type: "page-advanced", pageId, latestPageSequence: 4 });
    socket.serverMessage({ type: "page-advanced", pageId, latestPageSequence: 3 });
    socket.serverMessage({ type: "page-advanced", pageId, latestPageSequence: 7 });

    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ pageId, latestPageSequence: 7 });
    unsubscribe();
    socket.serverMessage({ type: "page-advanced", pageId, latestPageSequence: 8 });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    transport.stop();
  });

  it("returns timed-out work to the reconciler without losing or duplicating it", async () => {
    vi.useFakeTimers();
    const { transport } = openTransport({ requestTimeoutMs: 25 });
    const pending = transport.sync(generateUuidV7(), request());

    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({
      ok: false,
      offline: true,
      problem: { code: "realtime.timeout" },
    });
    transport.stop();
  });

  it("replays a retryable live refusal with the same immutable request before the safety sweep", async () => {
    vi.useFakeTimers();
    const { socket, transport } = openTransport({ random: () => 0 });
    const pageId = generateUuidV7();
    const body = request();
    const result = transport.sync(pageId, body);
    const firstFrame = socket.sent[1];

    socket.serverMessage({
      type: "sync-problem",
      requestId: body.requestId,
      pageId,
      offline: false,
      retryable: true,
      retryAfterMs: 50,
      problem: {
        code: "realtime.transaction-retry",
        message: "The transaction can be retried.",
      },
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(socket.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.sent).toHaveLength(3);
    expect(socket.sent[2]).toBe(firstFrame);

    socket.serverMessage({
      type: "sync-result",
      requestId: body.requestId,
      pageId,
      response: activeResponse(pageId, body.requestId, 1),
    });
    await expect(result).resolves.toMatchObject({
      ok: true,
      value: { pageId, latestPageSequence: 1 },
    });
    transport.stop();
  });

  it("abandons a silent half-open socket and reconnects after full-jitter backoff", async () => {
    vi.useFakeTimers();
    const { factory, socket, transport } = openTransport({ reconnect: true, random: () => 0.5 });

    await vi.advanceTimersByTimeAsync(REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS);
    expect(socket.readyState).toBe(socket.CLOSED);
    expect(transport.state).toBe("backoff");
    expect(factory.sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(249);
    expect(factory.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(factory.sockets).toHaveLength(2);
    expect(transport.state).toBe("connecting");
    transport.stop();
  });

  it("extends liveness whenever the server heartbeat arrives", async () => {
    vi.useFakeTimers();
    const { socket, transport } = openTransport();

    await vi.advanceTimersByTimeAsync(20_000);
    socket.serverMessage({ type: "ping", nonce: generateUuidV7() });
    await vi.advanceTimersByTimeAsync(REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS - 1);
    expect(transport.state).toBe("ready");
    expect(socket.readyState).toBe(socket.OPEN);

    await vi.advanceTimersByTimeAsync(1);
    expect(transport.state).toBe("idle");
    expect(socket.readyState).toBe(socket.CLOSED);
    transport.stop();
  });

  it("cuts an established channel while offline and reconnects only after the network returns", async () => {
    const { factory, socket, transport } = openTransport({ reconnect: true });
    const pageId = generateUuidV7();

    transport.setNetworkAvailable(false);

    expect(socket.readyState).toBe(socket.CLOSED);
    expect(transport.state).toBe("idle");
    await expect(transport.sync(pageId, request())).resolves.toMatchObject({
      ok: false,
      offline: true,
      problem: { code: "realtime.disconnected" },
    });
    expect(factory.sockets).toHaveLength(1);

    transport.setNetworkAvailable(true);
    expect(factory.sockets).toHaveLength(2);
    expect(transport.state).toBe("connecting");
    transport.stop();
  });

  it("uses HTTP only when the socket has not claimed the request", async () => {
    const fallback: PageSyncTransport = {
      sync: vi.fn(async (pageId, body) => ({
        ok: true as const,
        value: activeResponse(pageId, body.requestId),
      })),
      convertLegacyBranch: vi.fn(async () => ({
        ok: false as const,
        offline: true,
        problem: { code: "unused", message: "unused" },
      })),
    };
    const factory = new FakeWebSocketFactory();
    const transport = new RealtimePageSyncTransport({
      csrfToken: () => "csrf-secret",
      socketFactory: factory.create,
      fallback,
      connectWaitMs: 0,
      reconnect: false,
    });
    transport.start();
    const pageId = generateUuidV7();
    const body = request();

    await expect(transport.sync(pageId, body)).resolves.toMatchObject({ ok: true });
    expect(fallback.sync).toHaveBeenCalledOnce();
    expect(factory.latest.sent).toEqual([]);
    transport.stop();
  });

  it("delegates protected ambiguity details to HTTP without opening a socket request", async () => {
    const ambiguityId = generateUuidV7();
    const getAmbiguity = vi.fn(async () => ({
      ok: false as const,
      offline: false,
      problem: { code: "ambiguity.not-found", message: "No such ambiguity." },
    }));
    const fallback: PageSyncTransport = {
      sync: vi.fn(async () => ({
        ok: false as const,
        offline: true,
        problem: { code: "unused", message: "unused" },
      })),
      convertLegacyBranch: vi.fn(async () => ({
        ok: false as const,
        offline: true,
        problem: { code: "unused", message: "unused" },
      })),
      getAmbiguity,
    };
    const { socket, transport } = openTransport({ fallback });
    const sentBeforeRead = [...socket.sent];

    await expect(transport.getAmbiguity(ambiguityId)).resolves.toMatchObject({
      ok: false,
      problem: { code: "ambiguity.not-found" },
    });
    expect(getAmbiguity).toHaveBeenCalledWith(ambiguityId);
    expect(socket.sent).toEqual(sentBeforeRead);
    transport.stop();
  });
});
