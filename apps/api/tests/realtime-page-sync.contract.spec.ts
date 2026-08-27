import {
  MAX_PAGE_UPDATE_BATCH_BYTES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  parseRealtimePageSyncServerFrame,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
  type RealtimePageSyncServerMessageDto,
} from "@myownnotion/contracts";
import { readPageOperationUpdate } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
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

  takeType<T extends RealtimePageSyncServerMessageDto["type"]>(
    type: T,
  ): Extract<RealtimePageSyncServerMessageDto, { type: T }> | undefined {
    const index = this.#messages.findIndex((message) => message.type === type);
    if (index < 0) return undefined;
    return this.#messages.splice(index, 1)[0] as Extract<
      RealtimePageSyncServerMessageDto,
      { type: T }
    >;
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

async function connect(headers: Record<string, string>, origin = "http://127.0.0.1:5173") {
  const socket = await connectRealWebSocket(harness.api.built.app, "/v1/page-sync/socket", {
    cookie: headers["cookie"],
    origin,
  });
  sockets.add(socket);
  return { socket, messages: new MessageQueue(socket) };
}

async function authorize(
  connection: Awaited<ReturnType<typeof connect>>,
  headers: Record<string, string>,
) {
  const requestId = generateUuidV7();
  connection.socket.send(
    JSON.stringify({
      type: "hello",
      requestId,
      realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
      pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
      csrfToken: headers["x-csrf-token"],
    }),
  );
  const ready = await connection.messages.nextType("ready");
  expect(ready).toMatchObject({ requestId, realtimeProtocolVersion: 1 });
  return ready;
}

async function activate(
  page: Awaited<ReturnType<typeof harness.createLegacyPage>>,
  headers: Record<string, string>,
) {
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${page.itemId}/activate`,
    headers,
    payload: {
      requestId: generateUuidV7(),
      expectedRevisionId: page.revisionId,
      expectedCanonicalDigest: page.canonicalDigest,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as {
    checkpointBytes: string;
    checkpointDigest: string;
    versionVector: string;
  };
}

describe("realtime page synchronization", () => {
  it("refuses a browser upgrade whose Origin is not the configured public origin", async () => {
    const headers = await harness.authenticate();

    await expect(connect(headers, "https://attacker.invalid")).rejects.toThrow();
  });

  it("requires the memory-only CSRF token in hello before declaring the socket ready", async () => {
    const headers = await harness.authenticate();
    const connection = await connect(headers);
    const requestId = generateUuidV7();
    connection.socket.send(
      JSON.stringify({
        type: "hello",
        requestId,
        realtimeProtocolVersion: 1,
        pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
        csrfToken: "not-the-session-token",
      }),
    );

    await expect(connection.messages.nextType("refused")).resolves.toMatchObject({
      requestId,
      code: "csrf_validation_failed",
    });
    await expect(
      new Promise<number>((resolve) => connection.socket.once("close", resolve)),
    ).resolves.toBe(4403);
  });

  it("correlates a committed update and broadcasts only its durable page frontier", async () => {
    const headers = await harness.authenticate();
    const page = await harness.createLegacyPage("Realtime page");
    const checkpoint = await activate(page, headers);
    const author = await OperationalPageDocument.fromSnapshotTransport({
      pageId: page.itemId,
      snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
      snapshotDigest: checkpoint.checkpointDigest,
      versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
    });
    const blockId = generateUuidV7();
    const transaction = author.transact([
      {
        type: "insert-block",
        block: { type: "paragraph", id: blockId, content: [{ text: "Instant" }] },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const updateId = generateUuidV7();
    const requestId = generateUuidV7();
    const first = await connect(headers);
    const second = await connect(headers);
    await Promise.all([authorize(first, headers), authorize(second, headers)]);

    first.socket.send(
      JSON.stringify({
        type: "sync",
        requestId,
        pageId: page.itemId,
        request: {
          mode: "active",
          requestId,
          operationalVersion: 1,
          persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString(
            "base64url",
          ),
          knownServerPageSequence: 0,
          updates: [
            {
              updateId,
              baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
              updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
              updateDigest: await sha256Hex(transaction.updateBytes),
              createdAt: "2026-08-25T08:00:00.000Z",
            },
          ],
          maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
        },
      }),
    );

    const [result, announcement] = await Promise.all([
      first.messages.nextType("sync-result"),
      second.messages.nextType("page-advanced"),
    ]);
    expect(result).toMatchObject({
      requestId,
      pageId: page.itemId,
      response: { mode: "active", accepted: [{ updateId, pageSequence: 1 }] },
    });
    expect(announcement).toEqual({
      type: "page-advanced",
      pageId: page.itemId,
      latestPageSequence: 1,
    });
    await expect(
      readPageOperationUpdate(harness.api.built.database.db, updateId as Uuid),
    ).resolves.toMatchObject({ id: updateId, pageSequence: 1 });

    const replayRequestId = generateUuidV7();
    first.socket.send(
      JSON.stringify({
        type: "sync",
        requestId: replayRequestId,
        pageId: page.itemId,
        request: {
          mode: "active",
          requestId: replayRequestId,
          operationalVersion: 1,
          persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString(
            "base64url",
          ),
          knownServerPageSequence: 1,
          updates: [
            {
              updateId,
              baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
              updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
              updateDigest: await sha256Hex(transaction.updateBytes),
              createdAt: "2026-08-25T08:00:00.000Z",
            },
          ],
          maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
        },
      }),
    );
    await expect(first.messages.nextType("sync-result")).resolves.toMatchObject({
      requestId: replayRequestId,
      response: { accepted: [], repeated: [{ updateId, pageSequence: 1 }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.messages.takeType("page-advanced")).toBeUndefined();

    const refusedRequestId = generateUuidV7();
    first.socket.send(
      JSON.stringify({
        type: "sync",
        requestId: refusedRequestId,
        pageId: page.itemId,
        request: {
          mode: "active",
          requestId: refusedRequestId,
          operationalVersion: 1,
          persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString(
            "base64url",
          ),
          knownServerPageSequence: 1,
          updates: [
            {
              updateId: generateUuidV7(),
              baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
              updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
              updateDigest: "b".repeat(64),
              createdAt: "2026-08-25T08:00:01.000Z",
            },
          ],
          maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
        },
      }),
    );
    await expect(first.messages.nextType("sync-problem")).resolves.toMatchObject({
      requestId: refusedRequestId,
      problem: { code: "page-operations.digest-mismatch" },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.messages.takeType("page-advanced")).toBeUndefined();
  });

  it("does not accept content before hello and never echoes the rejected payload", async () => {
    const headers = await harness.authenticate();
    const connection = await connect(headers);
    const pageId = generateUuidV7();
    const requestId = generateUuidV7();
    const secret = "must-not-be-echoed";
    connection.socket.send(
      JSON.stringify({ type: "sync", requestId, pageId, request: { secret } }),
    );

    const closed = await new Promise<{ code: number; reason: string }>((resolve) =>
      connection.socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      ),
    );
    expect(closed.code).toBe(4400);
    expect(closed.reason).not.toContain(secret);
  });
});
