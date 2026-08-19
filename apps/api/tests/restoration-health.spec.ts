/** An interrupted restoration makes the installation observably unhealthy (T027). */

import { finishRestoration, recordBackup, startRestoration } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;

beforeAll(async () => {
  harness = await createApiHarness();
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

describe("health while a restoration is unfinished", () => {
  it("refuses readiness and says how to resume or roll back", async () => {
    const backupId = generateUuidV7();
    const attemptId = generateUuidV7();
    await recordBackup(harness.built.context.db, {
      id: backupId,
      workspaceId: harness.built.context.workspaceId,
      cursor: "42",
      applicationVersion: "0.1.0",
      schemaVersion: 1,
      recordFormatVersion: 1,
      byteLength: 128,
      digest: `sha256:${"a".repeat(64)}`,
      reason: "manual",
    });
    await startRestoration(harness.built.context.db, {
      id: attemptId,
      backupId,
      kind: "destructive",
    });

    const interrupted = await harness.built.app.inject({ method: "GET", url: "/health" });
    expect(interrupted.statusCode).toBe(503);
    const body = interrupted.json() as { status: string; recovery: string };
    expect(body.status).toBe("restoration-incomplete");
    expect(body.recovery).toMatch(/re-run.*restore/i);
    expect(body.recovery).toMatch(/safety backup/i);

    await finishRestoration(harness.built.context.db, {
      id: attemptId,
      outcome: "failed",
      detail: "test cleanup",
    });
    expect((await harness.built.app.inject({ method: "GET", url: "/health" })).statusCode).toBe(
      200,
    );
  });
});
