import { Writable } from "node:stream";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { createApplicationLogger } from "../src/plugins/logging.ts";
import {
  REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS,
  RealtimePageSyncObservability,
} from "../src/realtime/page-sync-observability.ts";

function captureLogger(): {
  logger: ReturnType<typeof createApplicationLogger>;
  read: () => string;
} {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: createApplicationLogger({
      env: { MYOWNNOTION_LOG_COLOR: "never", MYOWNNOTION_LOG_LEVEL: "debug" },
      isTTY: false,
      destination,
    }),
    read: () => chunks.join(""),
  };
}

describe("RealtimePageSyncObservability", () => {
  it("keeps finite metric dimensions and cumulative latency buckets", () => {
    const captured = captureLogger();
    let now = 1_000;
    const observer = new RealtimePageSyncObservability(captured.logger, { now: () => now });
    const connectionId = generateUuidV7();
    const deviceId = generateUuidV7();
    observer.sessionOpened({ connectionId, deviceId });
    observer.sessionReady({ connectionId, deviceId });
    const exchange = observer.beginExchange({
      connectionId,
      deviceId,
      requestId: generateUuidV7(),
      mode: "active",
      batchSize: 3,
    });
    now += 120;
    exchange.finish({ outcome: "accepted" });
    exchange.finish({ outcome: "internal-error" });
    observer.sessionClosed({ connectionId, deviceId, code: 1001 });

    const snapshot = observer.snapshot();
    expect(snapshot).toMatchObject({
      activeSessions: 0,
      activeExchanges: 0,
      sessionsOpened: 1,
      sessionsReady: 1,
      sessionsClosed: 1,
      closesByCategory: { shutdown: 1 },
      exchangesByMode: { active: 1, empty: 0, "legacy-branch": 0 },
      exchangesByOutcome: { accepted: 1, "internal-error": 0 },
    });
    expect(Object.keys(snapshot.closesByCategory)).toHaveLength(8);
    expect(Object.keys(snapshot.exchangesByOutcome)).toHaveLength(8);
    expect(snapshot.exchangeLatency).toHaveLength(REALTIME_PAGE_SYNC_LATENCY_BUCKETS_MS.length);
    expect(snapshot.exchangeLatency.find(({ upperBoundMs }) => upperBoundMs === 100)?.count).toBe(
      0,
    );
    expect(snapshot.exchangeLatency.find(({ upperBoundMs }) => upperBoundMs === 250)?.count).toBe(
      1,
    );
    expect(snapshot.exchangeLatency.at(-1)).toEqual({ upperBoundMs: null, count: 1 });
  });

  it("logs correlation and a fixed diagnostic code without accepting private payload fields", () => {
    const captured = captureLogger();
    const observer = new RealtimePageSyncObservability(captured.logger);
    const connectionId = generateUuidV7();
    const deviceId = generateUuidV7();
    const requestId = generateUuidV7();
    const secret = "private-owner-content-sentinel";
    observer.sessionOpened({ connectionId, deviceId });
    observer
      .beginExchange({
        connectionId,
        deviceId,
        requestId,
        mode: "active",
        batchSize: 1,
      })
      .finish({ outcome: "rejected", safeCode: secret });

    const output = captured.read();
    expect(output).toContain(connectionId);
    expect(output).toContain(deviceId);
    expect(output).toContain(requestId);
    expect(output).toContain("realtime.sync.rejected");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("updateBytes");
    expect(output).not.toContain("versionVector");
  });
});
