import { EventEmitter } from "node:events";
import { generateUuidV7 } from "@myownnotion/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { RawData, WebSocket } from "ws";
import {
  type PageSyncSocketRouteDeps,
  registerPageSyncSocketRoutes,
} from "../src/routes/page-sync-socket.ts";
import type { RequestPrincipal } from "../src/security/request-context.ts";

type SocketHandler = (socket: WebSocket, request: FastifyRequest) => Promise<void>;

class FakeServerSocket extends EventEmitter {
  readonly closes: Array<{ code: number; reason: string }> = [];
  readyState = 1;

  close(code: number, reason: string): void {
    this.readyState = 3;
    this.closes.push({ code, reason });
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

function request() {
  return {
    log: { error: vi.fn() },
  } as unknown as FastifyRequest;
}

function captureHandler(
  authenticate: PageSyncSocketRouteDeps["authenticate"],
  createSession: Parameters<typeof registerPageSyncSocketRoutes>[2],
): SocketHandler {
  let handler: SocketHandler | undefined;
  const app = {
    get: (_path: string, _options: unknown, candidate: SocketHandler) => {
      handler = candidate;
    },
  } as unknown as FastifyInstance;
  const deps = { authenticate } as unknown as PageSyncSocketRouteDeps;
  registerPageSyncSocketRoutes(app, deps, createSession);
  if (handler === undefined) throw new Error("page-sync socket handler was not registered");
  return handler;
}

function deferredAuthentication() {
  let resolve: (principal: ReturnType<typeof owner> | null) => void = () => undefined;
  const promise = new Promise<ReturnType<typeof owner> | null>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("page-sync socket authentication boundary", () => {
  it("replays an eager frame only after durable authentication attaches the session", async () => {
    const authentication = deferredAuthentication();
    const replayed: Array<{ frame: RawData; isBinary: boolean }> = [];
    const handler = captureHandler(
      async () => await authentication.promise,
      ({ socket }) => {
        socket.on("message", (frame: RawData, isBinary: boolean) => {
          replayed.push({ frame, isBinary });
        });
      },
    );
    const socket = new FakeServerSocket();
    const handling = handler(socket as unknown as WebSocket, request());
    const frame = Buffer.from("eager-hello");

    socket.emit("message", frame, false);
    expect(replayed).toEqual([]);
    authentication.resolve(owner());
    await handling;

    expect(replayed).toEqual([{ frame, isBinary: false }]);
  });

  it("closes a socket whose bounded pre-authentication queue overflows", async () => {
    const authentication = deferredAuthentication();
    const createSession = vi.fn();
    const handler = captureHandler(async () => await authentication.promise, createSession);
    const socket = new FakeServerSocket();
    const handling = handler(socket as unknown as WebSocket, request());

    for (let index = 0; index < 9; index += 1) {
      socket.emit("message", Buffer.from(String(index)), false);
    }
    authentication.resolve(owner());
    await handling;

    expect(socket.closes).toEqual([{ code: 1009, reason: "authentication-buffer-full" }]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("closes a connection whose durable session no longer exists", async () => {
    const createSession = vi.fn();
    const handler = captureHandler(async () => null, createSession);
    const socket = new FakeServerSocket();

    await handler(socket as unknown as WebSocket, request());

    expect(socket.closes).toEqual([{ code: 4401, reason: "authentication-required" }]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("logs an authentication failure and closes an open connection", async () => {
    const failure = new Error("database unavailable");
    const handler = captureHandler(async () => {
      throw failure;
    }, vi.fn());
    const socket = new FakeServerSocket();
    const fakeRequest = request();

    await handler(socket as unknown as WebSocket, fakeRequest);

    expect(fakeRequest.log.error).toHaveBeenCalledWith(
      { err: failure },
      "realtime owner authentication failed",
    );
    expect(socket.closes).toEqual([{ code: 1011, reason: "authentication-failed" }]);
  });
});
