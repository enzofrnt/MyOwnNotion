import { EventEmitter } from "node:events";
import {
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS,
  REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
} from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { PageSyncHub } from "../src/realtime/page-sync-hub.ts";
import { RealtimePageSyncObservability } from "../src/realtime/page-sync-observability.ts";
import { PageSyncSession } from "../src/realtime/page-sync-session.ts";
import type { RequestPrincipal } from "../src/security/request-context.ts";

class FakeServerSocket extends EventEmitter {
  readonly sent: string[] = [];
  readonly closes: { code: number; reason: string }[] = [];
  readyState = 1;

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(code: number, reason: string): void {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.closes.push({ code, reason });
    this.emit("close", code, Buffer.from(reason));
  }

  clientMessage(message: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(message)), false);
  }

  clientFrame(frame: string): void {
    this.emit("message", Buffer.from(frame), false);
  }
}

function owner(): Extract<RequestPrincipal, { kind: "owner" }> {
  return {
    kind: "owner",
    ownerId: generateUuidV7(),
    sessionId: generateUuidV7(),
    deviceId: generateUuidV7(),
    recentAuthAt: new Date(),
  };
}

function logger() {
  return { debug: vi.fn(), info: vi.fn() };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function hello(socket: FakeServerSocket): void {
  socket.clientMessage({
    type: "hello",
    requestId: generateUuidV7(),
    realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
    pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
    csrfToken: "csrf-test-token",
  });
}

function sync(socket: FakeServerSocket, pageId = generateUuidV7(), requestId = generateUuidV7()) {
  socket.clientMessage({
    type: "sync",
    requestId,
    pageId,
    request: {
      mode: "empty",
      requestId,
      knownServerPageSequence: 0,
      maxRemoteBytes: 1_024,
    },
  });
  return { pageId, requestId };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PageSyncSession lifecycle", () => {
  it("closes oversized text before parsing it", async () => {
    const socket = new FakeServerSocket();
    const principal = owner();
    new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub: new PageSyncHub(),
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice: async () => true,
      synchronize: async () => {
        throw new Error("not used");
      },
    });

    socket.clientFrame("x".repeat(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES + 1));
    await flush();

    expect(socket.closes).toEqual([{ code: 1009, reason: "message-too-large" }]);
  });

  it("closes a connection that exceeds its bounded frame rate", async () => {
    const socket = new FakeServerSocket();
    const principal = owner();
    new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub: new PageSyncHub(),
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice: async () => true,
      synchronize: async () => {
        throw new Error("not used");
      },
    });
    hello(socket);
    await flush();

    for (let index = 0; index < 120; index += 1) {
      socket.clientMessage({ type: "pong", nonce: `nonce-${index}` });
    }
    await flush();

    expect(socket.closes).toEqual([{ code: 4429, reason: "rate-limited" }]);
  });

  it("closes duplicate page work instead of growing an ambiguous queue", async () => {
    const socket = new FakeServerSocket();
    const principal = owner();
    const never = new Promise<never>(() => {});
    new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub: new PageSyncHub(),
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice: async () => true,
      synchronize: async () => await never,
    });
    hello(socket);
    await flush();
    const first = sync(socket);
    await flush();
    sync(socket, first.pageId);
    await flush();

    expect(socket.sent.map((frame) => JSON.parse(frame))).toContainEqual(
      expect.objectContaining({
        type: "sync-problem",
        problem: expect.objectContaining({ code: "realtime.duplicate-in-flight" }),
      }),
    );
    expect(socket.closes).toEqual([{ code: 4409, reason: "page-in-flight" }]);
  });

  it("admits at most eight concurrent exchanges", async () => {
    const socket = new FakeServerSocket();
    const principal = owner();
    const never = new Promise<never>(() => {});
    new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub: new PageSyncHub(),
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice: async () => true,
      synchronize: async () => await never,
    });
    hello(socket);
    await flush();
    for (let index = 0; index < 9; index += 1) sync(socket);
    await flush();

    expect(socket.closes).toEqual([{ code: 4429, reason: "too-many-in-flight" }]);
  });

  it("releases the socket, hub, heartbeat and metrics during server shutdown", async () => {
    vi.useFakeTimers();
    const socket = new FakeServerSocket();
    const principal = owner();
    const hub = new PageSyncHub();
    const observability = new RealtimePageSyncObservability(logger());
    const reauthorizeDevice = vi.fn(async () => true);
    const session = new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub,
      observability,
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice,
      synchronize: async () => {
        throw new Error("not used");
      },
    });
    const requestId = generateUuidV7();
    socket.clientMessage({
      type: "hello",
      requestId,
      realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
      pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
      csrfToken: "csrf-test-token",
    });
    await flush();
    expect(session.state).toBe("ready");
    expect(hub.size).toBe(1);
    expect(observability.snapshot()).toMatchObject({ activeSessions: 1, sessionsReady: 1 });

    hub.close();

    expect(socket.closes).toEqual([{ code: 1001, reason: "server-shutdown" }]);
    expect(session.state).toBe("closed");
    expect(hub.size).toBe(0);
    expect(observability.snapshot()).toMatchObject({
      activeSessions: 0,
      sessionsClosed: 1,
      closesByCategory: { shutdown: 1 },
    });
    await vi.advanceTimersByTimeAsync(REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS * 2);
    expect(reauthorizeDevice).not.toHaveBeenCalled();
  });

  it("closes a ready session that stops answering application heartbeats", async () => {
    vi.useFakeTimers();
    const socket = new FakeServerSocket();
    const principal = owner();
    const hub = new PageSyncHub();
    const session = new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub,
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice: async () => true,
      synchronize: async () => {
        throw new Error("not used");
      },
    });
    socket.clientMessage({
      type: "hello",
      requestId: generateUuidV7(),
      realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
      pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
      csrfToken: "csrf-test-token",
    });
    await flush();

    await vi.advanceTimersByTimeAsync(REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS);

    expect(socket.sent.filter((frame) => JSON.parse(frame).type === "ping")).toHaveLength(
      REALTIME_PAGE_SYNC_LIVENESS_TIMEOUT_MS / REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS - 1,
    );
    expect(socket.closes).toEqual([{ code: 4408, reason: "liveness-timeout" }]);
    expect(session.state).toBe("closed");
    expect(hub.size).toBe(0);
  });

  it("revalidates the device on heartbeat and closes a newly revoked session", async () => {
    vi.useFakeTimers();
    const socket = new FakeServerSocket();
    const principal = owner();
    const hub = new PageSyncHub();
    const reauthorizeDevice = vi.fn(async () => false);
    new PageSyncSession({
      socket: socket as unknown as WebSocket,
      principal,
      hub,
      authorizeHello: async () => ({ allowed: true, owner: principal }),
      reauthorizeDevice,
      synchronize: async () => {
        throw new Error("not used");
      },
    });
    hello(socket);
    await flush();

    await vi.advanceTimersByTimeAsync(REALTIME_PAGE_SYNC_HEARTBEAT_INTERVAL_MS);

    expect(reauthorizeDevice).toHaveBeenCalledOnce();
    expect(socket.closes).toEqual([{ code: 4403, reason: "device-revoked" }]);
    expect(hub.size).toBe(0);
  });
});
