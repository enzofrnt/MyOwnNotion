/** The performance runner executes this real 2 GiB workload in its own process. */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, createInstallation, getOrCreateWorkspace } from "@myownnotion/database";
import { startMigratedPostgres } from "@myownnotion/test-utils";
import { expect, it } from "vitest";
import { createProtectedFileRuntime } from "../../apps/api/src/files/protected-file-runtime.ts";
import { INSTALLATION_ID } from "../../apps/api/src/security/protected-content-runtime.ts";

it("streams and authenticates 2 GiB plus chunk-crossing ranges below 256 MiB additional RSS", async () => {
  const postgres = await startMigratedPostgres();
  const handle = createDatabase(postgres.connectionString);
  const blobRoot = await mkdtemp(join(tmpdir(), "mon-protected-file-memory-"));
  try {
    const workspace = await getOrCreateWorkspace(handle.db);
    await createInstallation(handle.db, {
      id: INSTALLATION_ID,
      sourceLineageId: INSTALLATION_ID,
      schemaVersion: workspace.schemaVersion,
    });
    const key = randomBytes(32);
    const runtime = createProtectedFileRuntime({
      db: handle.db,
      workspaceId: workspace.id,
      blobRoot,
      deploymentKey: () => key,
    });
    await handle.db.transaction((tx) => runtime.keys.initialize(tx));
    const total = 2 * 1024 ** 3;
    const block = randomBytes(64 * 1024);
    const expected = createHash("sha256");
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const sample = () => {
      peak = Math.max(peak, process.memoryUsage().rss);
    };
    const timer = setInterval(sample, 5);
    try {
      async function* source() {
        for (let offset = 0; offset < total; offset += block.length) {
          expected.update(block);
          sample();
          yield block;
        }
      }
      const stored = await handle.db.transaction((tx) =>
        runtime.files.ingest(tx, source(), { maxBytes: total }),
      );
      const actual = createHash("sha256");
      let length = 0;
      for await (const bytes of runtime.files.read(handle.db, stored.contentId)) {
        actual.update(bytes);
        length += bytes.length;
        sample();
      }
      expect(length).toBe(total);
      expect(actual.digest("hex")).toBe(expected.digest("hex"));
      for (const start of [4 * 1024 ** 2 - 17, 1024 ** 3 - 17, total - 131]) {
        let offset = start;
        const end = Math.min(total - 1, start + 130);
        for await (const bytes of runtime.files.read(handle.db, stored.contentId, { start, end })) {
          for (const byte of bytes) expect(byte).toBe(block[offset++ % block.length]);
          sample();
        }
        expect(offset).toBe(end + 1);
      }
      console.info(
        `[perf] protected 2GiB ingest/full-read/ranges baselineRSS=${(baseline / 1024 ** 2).toFixed(1)}MiB peakRSS=${(peak / 1024 ** 2).toFixed(1)}MiB additionalRSS=${((peak - baseline) / 1024 ** 2).toFixed(1)}MiB`,
      );
      expect(peak - baseline).toBeLessThan(256 * 1024 ** 2);
    } finally {
      clearInterval(timer);
    }
  } finally {
    await handle.close();
    await postgres.stop();
    await rm(blobRoot, { recursive: true, force: true });
  }
});
