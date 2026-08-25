/** Reference overhead and bounded-memory checks for the persistent page channel. */

import {
  type ActivePageSyncRequestDto,
  PAGE_OPERATION_PROTOCOL_VERSION,
  type RealtimePageSyncReadySchema,
} from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, describe, expect, it } from "vitest";
import { RealtimePageSyncTransport } from "../../apps/web/src/services/realtime-page-sync-transport.ts";
import { FakeWebSocketFactory } from "../../apps/web/tests/support/fake-websocket.ts";
import { percentile, REALTIME_SYNC_BUDGETS } from "./reference-machine.ts";

const CANONICAL_DIGEST = "a".repeat(64);
const transports: RealtimePageSyncTransport[] = [];

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

function response(pageId: Uuid, requestId: Uuid, sequence: number) {
  return {
    mode: "active" as const,
    requestId,
    pageId,
    accepted: [],
    repeated: [],
    remoteUpdates: [],
    serverVersionVector: "",
    throughPageSequence: sequence,
    latestPageSequence: sequence,
    hasMore: false,
    canonical: {
      format: "myownnotion.document+json" as const,
      formatVersion: 3 as const,
      digest: CANONICAL_DIGEST,
      lastConsolidatedRevisionId: null,
      hasUnconsolidatedChanges: false,
    },
    ambiguities: [],
    fileRequirements: [],
  };
}

function openTransport() {
  const factory = new FakeWebSocketFactory();
  const transport = new RealtimePageSyncTransport({
    baseUrl: "https://reference.local",
    csrfToken: () => "reference-csrf",
    socketFactory: factory.create,
    reconnect: false,
  });
  transports.push(transport);
  transport.start();
  const socket = factory.latest;
  socket.open();
  const hello = JSON.parse(socket.sent[0] ?? "null") as { requestId: Uuid };
  socket.serverMessage(ready(hello.requestId));
  return { socket, transport };
}

afterEach(() => {
  for (const transport of transports.splice(0)) transport.stop();
});

describe("realtime page synchronization reference budgets", () => {
  it("opens and authenticates one persistent connection within the p95 budget", () => {
    const samples: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      const { transport } = openTransport();
      samples.push(performance.now() - started);
      expect(transport.state).toBe("ready");
      transport.stop();
    }
    const p95 = percentile(samples, 0.95);
    console.info(`[perf] realtime handshake p95=${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThan(REALTIME_SYNC_BUDGETS.handshakeP95Ms);
  });

  it("correlates durable responses within the client overhead budget", async () => {
    const { socket, transport } = openTransport();
    const pageId = generateUuidV7();
    const samples: number[] = [];
    for (let sequence = 1; sequence <= 250; sequence += 1) {
      const body = request();
      const started = performance.now();
      const pending = transport.sync(pageId, body);
      socket.serverMessage({
        type: "sync-result",
        requestId: body.requestId,
        pageId,
        response: response(pageId, body.requestId as Uuid, sequence),
      });
      await expect(pending).resolves.toMatchObject({ ok: true });
      samples.push(performance.now() - started);
    }
    const p95 = percentile(samples, 0.95);
    console.info(`[perf] realtime correlated response p95=${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThan(REALTIME_SYNC_BUDGETS.correlatedRoundTripP95Ms);
  });

  it("coalesces 10,000 announcements to one frontier with bounded time and memory", async () => {
    const { socket, transport } = openTransport();
    const pageId = generateUuidV7();
    const seen: number[] = [];
    transport.subscribePageAdvances(({ latestPageSequence }) => seen.push(latestPageSequence));
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (let sequence = 1; sequence <= 10_000; sequence += 1) {
      socket.serverMessage({ type: "page-advanced", pageId, latestPageSequence: sequence });
    }
    await Promise.resolve();
    const durationMs = performance.now() - started;
    const heapGrowthBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
    console.info(
      `[perf] realtime 10k announcements duration=${durationMs.toFixed(1)}ms heapGrowth=${(
        heapGrowthBytes / 1024 / 1024
      ).toFixed(1)}MiB`,
    );
    expect(seen).toEqual([10_000]);
    expect(durationMs).toBeLessThan(REALTIME_SYNC_BUDGETS.tenThousandAnnouncementsMs);
    expect(heapGrowthBytes).toBeLessThan(REALTIME_SYNC_BUDGETS.maxPeakHeapGrowthBytes);
  });
});
