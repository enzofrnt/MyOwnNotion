import {
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
} from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import {
  MAX_REALTIME_PAGE_SYNC_FRAMES_PER_WINDOW,
  PageSyncLimits,
  REALTIME_PAGE_SYNC_RATE_WINDOW_MS,
} from "../src/realtime/page-sync-limits.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";

let harness: AuthenticatedPageOperationHarness;
const sockets = new Set<WebSocket>();

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
  const socket = await harness.api.built.app.injectWS("/v1/page-sync/socket", {
    headers: { cookie: headers["cookie"], origin },
  });
  sockets.add(socket);
  return socket;
}

function closeOf(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

describe("realtime page-sync security contract", () => {
  it("requires a session cookie and the byte-for-byte configured Origin", async () => {
    const headers = await harness.authenticate();

    await expect(connect({}, "http://127.0.0.1:5173")).rejects.toThrow();
    await expect(connect(headers, "http://127.0.0.1:5173/")).rejects.toThrow();
    await expect(connect(headers, "http://localhost:5173")).rejects.toThrow();
  });

  it("closes an obsolete protocol before accepting any page request", async () => {
    const headers = await harness.authenticate();
    const socket = await connect(headers);
    const closed = closeOf(socket);
    socket.send(
      JSON.stringify({
        type: "hello",
        requestId: generateUuidV7(),
        realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION + 1,
        pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
        csrfToken: headers["x-csrf-token"],
      }),
    );

    await expect(closed).resolves.toEqual({ code: 4406, reason: "update-required" });
  });

  it("closes a frame above 2 MiB with the standard message-too-large code", async () => {
    const headers = await harness.authenticate();
    const socket = await connect(headers);
    const closed = closeOf(socket);

    socket.send("x".repeat(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES + 1));

    await expect(closed).resolves.toMatchObject({ code: 1009 });
  });

  it("bounds rate, request identities, pages and total concurrent work per connection", () => {
    let now = 1_000;
    const limits = new PageSyncLimits(() => now);
    for (let index = 0; index < MAX_REALTIME_PAGE_SYNC_FRAMES_PER_WINDOW; index += 1) {
      expect(limits.admitFrame("{}")).toEqual({ allowed: true });
    }
    expect(limits.admitFrame("{}")).toEqual({ allowed: false, reason: "rate-limited" });
    now += REALTIME_PAGE_SYNC_RATE_WINDOW_MS + 1;
    expect(limits.admitFrame("{}")).toEqual({ allowed: true });

    const claims = Array.from({ length: 8 }, () => ({
      requestId: generateUuidV7(),
      pageId: generateUuidV7(),
    }));
    for (const claim of claims) {
      expect(limits.admitExchange(claim.requestId, claim.pageId)).toEqual({ allowed: true });
    }
    const firstClaim = claims[0];
    if (firstClaim === undefined) throw new Error("the fixture needs one admitted exchange");
    expect(limits.admitExchange(firstClaim.requestId, generateUuidV7())).toEqual({
      allowed: false,
      reason: "duplicate-request",
    });
    expect(limits.admitExchange(generateUuidV7(), firstClaim.pageId)).toEqual({
      allowed: false,
      reason: "page-in-flight",
    });
    expect(limits.admitExchange(generateUuidV7(), generateUuidV7())).toEqual({
      allowed: false,
      reason: "too-many-in-flight",
    });
  });
});
