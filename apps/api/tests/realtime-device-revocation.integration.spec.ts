import {
  PAGE_OPERATION_PROTOCOL_VERSION,
  parseRealtimePageSyncServerFrame,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
  type RealtimePageSyncServerMessageDto,
} from "@myownnotion/contracts";
import { findDevice } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { authorizeSynchronizationWrite } from "../src/security/synchronization-authorization.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
  PAGE_OPERATION_DEVICE_ID,
  PAGE_OPERATION_OWNER_ID,
} from "./helpers/authenticated-page-operations.ts";
import { connectRealWebSocket } from "./helpers/real-websocket.ts";

let harness: AuthenticatedPageOperationHarness;
const sockets = new Set<WebSocket>();

class MessageQueue {
  readonly #messages: RealtimePageSyncServerMessageDto[] = [];
  readonly #waiters: Array<(message: RealtimePageSyncServerMessageDto) => void> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (frame) => {
      const message = parseRealtimePageSyncServerFrame(frame.toString());
      const waiter = this.#waiters.shift();
      if (waiter === undefined) this.#messages.push(message);
      else waiter(message);
    });
  }

  async next(): Promise<RealtimePageSyncServerMessageDto> {
    const queued = this.#messages.shift();
    if (queued !== undefined) return queued;
    return await new Promise((resolve) => this.#waiters.push(resolve));
  }

  async nextType<T extends RealtimePageSyncServerMessageDto["type"]>(
    type: T,
  ): Promise<Extract<RealtimePageSyncServerMessageDto, { type: T }>> {
    for (;;) {
      const message = await this.next();
      if (message.type === type) {
        return message as Extract<RealtimePageSyncServerMessageDto, { type: T }>;
      }
    }
  }
}

beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness();
  await harness.api.built.app.ready();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  await harness.reset();
});

afterEach(() => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
});

async function connect(headers: Record<string, string>) {
  const socket = await connectRealWebSocket(harness.api.built.app, "/v1/page-sync/socket", {
    cookie: headers["cookie"],
    origin: "http://127.0.0.1:5173",
  });
  sockets.add(socket);
  return { socket, messages: new MessageQueue(socket) };
}

function closeOf(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

function sendHello(socket: WebSocket, headers: Record<string, string>): void {
  socket.send(
    JSON.stringify({
      type: "hello",
      requestId: generateUuidV7(),
      realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
      pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
      csrfToken: headers["x-csrf-token"],
    }),
  );
}

async function revoke(headers: Record<string, string>) {
  return await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/devices/${PAGE_OPERATION_DEVICE_ID}/revoke`,
    headers,
  });
}

describe("realtime device revocation", () => {
  it("refuses hello when the device was revoked after upgrade", async () => {
    const headers = await harness.authenticate();
    const connection = await connect(headers);
    const closed = closeOf(connection.socket);
    const response = await revoke(headers);
    expect(response.statusCode, response.body).toBe(200);

    sendHello(connection.socket, headers);

    await expect(connection.messages.nextType("refused")).resolves.toMatchObject({
      code: "device_revoked",
    });
    await expect(closed).resolves.toEqual({ code: 4403, reason: "device_revoked" });
  });

  it("immediately closes every ready socket for the revoked device", async () => {
    const headers = await harness.authenticate();
    const first = await connect(headers);
    const second = await connect(headers);
    sendHello(first.socket, headers);
    sendHello(second.socket, headers);
    await Promise.all([first.messages.nextType("ready"), second.messages.nextType("ready")]);
    const firstClosed = closeOf(first.socket);
    const secondClosed = closeOf(second.socket);

    const response = await revoke(headers);

    expect(response.statusCode, response.body).toBe(200);
    await expect(firstClosed).resolves.toEqual({ code: 4403, reason: "device-revoked" });
    await expect(secondClosed).resolves.toEqual({ code: 4403, reason: "device-revoked" });
  });

  it("serializes revocation behind an authorized write lock and refuses every later write", async () => {
    const headers = await harness.authenticate();
    let releaseWrite!: () => void;
    let markWriteLocked!: () => void;
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeLocked = new Promise<void>((resolve) => {
      markWriteLocked = resolve;
    });
    const lockedWrite = harness.api.built.database.db.transaction(
      async (tx) => {
        const decision = await authorizeSynchronizationWrite(tx, {
          ownerId: PAGE_OPERATION_OWNER_ID,
          deviceId: PAGE_OPERATION_DEVICE_ID,
        });
        markWriteLocked();
        await writeReleased;
        return decision;
      },
      { isolationLevel: "read committed" },
    );
    await writeLocked;

    let revocationSettled = false;
    const revocation = revoke(headers).then((response) => {
      revocationSettled = true;
      return response;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(revocationSettled).toBe(false);

    releaseWrite();
    await expect(lockedWrite).resolves.toEqual({ allowed: true, deviceState: "active" });
    const response = await revocation;
    expect(response.statusCode, response.body).toBe(200);
    await expect(
      findDevice(harness.api.built.database.db, {
        ownerId: PAGE_OPERATION_OWNER_ID,
        deviceId: PAGE_OPERATION_DEVICE_ID,
      }),
    ).resolves.toMatchObject({ state: "revoked" });

    await expect(
      harness.api.built.database.db.transaction((tx) =>
        authorizeSynchronizationWrite(tx, {
          ownerId: PAGE_OPERATION_OWNER_ID,
          deviceId: PAGE_OPERATION_DEVICE_ID,
        }),
      ),
    ).resolves.toMatchObject({ allowed: false, refusal: "device_revoked" });
  });
});
