import {
  MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
  MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
  PAGE_OPERATION_PROTOCOL_VERSION,
  parseRealtimePageSyncClientFrame,
  parseRealtimePageSyncClientMessage,
  parseRealtimePageSyncServerFrame,
  parseRealtimePageSyncServerMessage,
  REALTIME_PAGE_SYNC_CLOSE_CODES,
  REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
  RealtimePageSyncContractError,
} from "@myownnotion/contracts";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);
const instant = "2026-08-25T10:00:00.000Z";

function activeRequest(requestId = generateUuidV7()) {
  return {
    mode: "active" as const,
    requestId,
    operationalVersion: 1 as const,
    persistedVersionVector: "AQ",
    knownServerPageSequence: 3,
    updates: [],
    maxRemoteBytes: 1024,
  };
}

function activeResponse(requestId: string, pageId: string) {
  return {
    mode: "active" as const,
    requestId,
    pageId,
    accepted: [],
    repeated: [],
    remoteUpdates: [],
    serverVersionVector: "AQ",
    throughPageSequence: 3,
    latestPageSequence: 3,
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

describe("realtime page-sync client messages", () => {
  it("parses hello, sync, ping and pong messages", () => {
    const helloRequestId = generateUuidV7();
    expect(
      parseRealtimePageSyncClientMessage({
        type: "hello",
        requestId: helloRequestId,
        realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
        pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
        csrfToken: "c".repeat(43),
      }),
    ).toMatchObject({ type: "hello", requestId: helloRequestId });

    const requestId = generateUuidV7();
    const pageId = generateUuidV7();
    expect(
      parseRealtimePageSyncClientMessage({
        type: "sync",
        requestId,
        pageId,
        request: activeRequest(requestId),
      }),
    ).toMatchObject({ type: "sync", requestId, pageId });

    const nonce = generateUuidV7();
    expect(parseRealtimePageSyncClientMessage({ type: "ping", nonce })).toEqual({
      type: "ping",
      nonce,
    });
    expect(parseRealtimePageSyncClientMessage({ type: "pong", nonce })).toEqual({
      type: "pong",
      nonce,
    });
  });

  it("requires the envelope and page request identities to match", () => {
    expect(() =>
      parseRealtimePageSyncClientMessage({
        type: "sync",
        requestId: generateUuidV7(),
        pageId: generateUuidV7(),
        request: activeRequest(generateUuidV7()),
      }),
    ).toThrow("request identity");
  });

  it("rejects unknown fields without repeating private values", () => {
    const privateValue = "private-draft-that-must-not-appear";
    let caught: unknown;
    try {
      parseRealtimePageSyncClientMessage({
        type: "hello",
        requestId: generateUuidV7(),
        realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
        pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
        csrfToken: "c".repeat(43),
        draft: privateValue,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RealtimePageSyncContractError);
    expect(String(caught)).not.toContain(privateValue);
  });

  it("bounds the encoded frame before parsing JSON", () => {
    const frame = JSON.stringify({
      type: "hello",
      requestId: generateUuidV7(),
      realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
      pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
      csrfToken: "x".repeat(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES),
    });
    expect(() => parseRealtimePageSyncClientFrame(frame)).toThrow("frame bytes");
    expect(() => parseRealtimePageSyncClientFrame("not-json")).toThrow(
      RealtimePageSyncContractError,
    );
  });
});

describe("realtime page-sync server messages", () => {
  it("parses ready and a correlated durable page response", () => {
    const helloRequestId = generateUuidV7();
    expect(
      parseRealtimePageSyncServerMessage({
        type: "ready",
        requestId: helloRequestId,
        connectionId: generateUuidV7(),
        realtimeProtocolVersion: REALTIME_PAGE_SYNC_PROTOCOL_VERSION,
        pageOperationProtocolVersion: PAGE_OPERATION_PROTOCOL_VERSION,
        heartbeatIntervalMs: 20_000,
        requestTimeoutMs: 30_000,
        maxMessageBytes: MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES,
        maxInFlight: MAX_REALTIME_PAGE_SYNC_IN_FLIGHT,
      }),
    ).toMatchObject({ type: "ready", requestId: helloRequestId });

    const requestId = generateUuidV7();
    const pageId = generateUuidV7();
    expect(
      parseRealtimePageSyncServerMessage({
        type: "sync-result",
        requestId,
        pageId,
        response: activeResponse(requestId, pageId),
      }),
    ).toMatchObject({ type: "sync-result", requestId, pageId });
  });

  it("requires response, envelope and page identities to match", () => {
    const requestId = generateUuidV7();
    const pageId = generateUuidV7();
    expect(() =>
      parseRealtimePageSyncServerMessage({
        type: "sync-result",
        requestId,
        pageId,
        response: activeResponse(generateUuidV7(), pageId),
      }),
    ).toThrow("response identity");
    expect(() =>
      parseRealtimePageSyncServerMessage({
        type: "sync-result",
        requestId,
        pageId,
        response: activeResponse(requestId, generateUuidV7()),
      }),
    ).toThrow("page identity");
  });

  it("parses safe problems, page announcements, refusal and heartbeat", () => {
    const requestId = generateUuidV7();
    const pageId = generateUuidV7();
    expect(
      parseRealtimePageSyncServerMessage({
        type: "sync-problem",
        requestId,
        pageId,
        offline: false,
        retryable: false,
        problem: { code: "page-operations.device-revoked", message: "Device revoked." },
      }),
    ).toMatchObject({ type: "sync-problem", requestId, pageId });
    expect(
      parseRealtimePageSyncServerMessage({
        type: "page-advanced",
        pageId,
        latestPageSequence: 42,
      }),
    ).toEqual({ type: "page-advanced", pageId, latestPageSequence: 42 });
    expect(
      parseRealtimePageSyncServerMessage({
        type: "refused",
        requestId,
        code: "csrf_validation_failed",
        message: "Refresh the authenticated session.",
      }),
    ).toMatchObject({ type: "refused", requestId });
    expect(parseRealtimePageSyncServerMessage({ type: "ping", nonce: requestId })).toMatchObject({
      type: "ping",
      nonce: requestId,
    });
    expect(parseRealtimePageSyncServerMessage({ type: "pong", nonce: requestId })).toMatchObject({
      type: "pong",
      nonce: requestId,
    });
  });

  it("bounds server frames and rejects invalid safe codes", () => {
    expect(() =>
      parseRealtimePageSyncServerMessage({
        type: "refused",
        requestId: generateUuidV7(),
        code: " ",
        message: "No.",
      }),
    ).toThrow(RealtimePageSyncContractError);
    expect(() => parseRealtimePageSyncServerFrame("x".repeat(2_097_153))).toThrow("frame bytes");
  });
});

describe("realtime page-sync protocol constants", () => {
  it("keeps stable limits and private-use close codes", () => {
    expect(REALTIME_PAGE_SYNC_PROTOCOL_VERSION).toBe(1);
    expect(MAX_REALTIME_PAGE_SYNC_MESSAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_REALTIME_PAGE_SYNC_IN_FLIGHT).toBe(8);
    expect(REALTIME_PAGE_SYNC_CLOSE_CODES).toEqual({
      messageTooLarge: 1009,
      invalidMessage: 4400,
      authenticationRequired: 4401,
      authorizationRefused: 4403,
      updateRequired: 4406,
      timeout: 4408,
      duplicateInFlight: 4409,
      rateLimited: 4429,
      internalError: 4500,
    });
    expect(instant).toMatch(/^2026-/u);
  });
});
