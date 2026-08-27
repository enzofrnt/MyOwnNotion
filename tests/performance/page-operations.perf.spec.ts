/**
 * Operational page synchronization reference benchmark (T190, US5).
 *
 * Exercises the real encrypted API and PostgreSQL path. The workload is
 * intentionally one long-lived page because replay, checkpoint rollover and
 * device-frontier costs are per page rather than per workspace.
 */

import {
  type ActivePageSyncResponseDto,
  MAX_PAGE_UPDATE_BATCH_BYTES,
  MAX_PAGE_UPDATES_PER_SYNC,
  type PageOperationUpdateDto,
} from "@myownnotion/contracts";
import { canonicalDocumentJsonV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  OperationalPageDocument,
  sha256Hex,
  versionVectorBytesEqual,
} from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PageCheckpointRetentionPolicy } from "../../apps/api/src/page-state/checkpoint-service.ts";
import { PAGE_OPERATION_REPLAY_CHECKPOINT_INTERVAL } from "../../apps/api/src/page-state/page-operation-service.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "../../apps/api/tests/helpers/authenticated-page-operations.ts";
import { REALTIME_SYNC_BUDGETS } from "./reference-machine.ts";

const RETURNING_DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000ef" as Uuid;
const UPDATE_COUNT = 10_000;
const MAX_INGEST_DURATION_MS = 300_000;
const MAX_CATCH_UP_DURATION_MS = REALTIME_SYNC_BUDGETS.tenThousandUpdateCatchUpMs;
const MAX_COMPACTION_DURATION_MS = 30_000;
const MAX_PEAK_LIVE_HEAP_GROWTH_BYTES = REALTIME_SYNC_BUDGETS.maxPeakLiveHeapGrowthBytes;

let currentTime = new Date("2026-08-24T12:00:00.000Z");
let backupVerified = false;
let historyReleased = false;
const retention: PageCheckpointRetentionPolicy = {
  checkpointIsInVerifiedBackup: async () => backupVerified,
  historyAllowsCompaction: async () => historyReleased,
};
let harness: AuthenticatedPageOperationHarness;

beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness({
    checkpointRetention: retention,
    now: () => currentTime,
  });
});

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  currentTime = new Date("2026-08-24T12:00:00.000Z");
  backupVerified = false;
  historyReleased = false;
  await harness.reset();
});

async function activate(
  page: { readonly itemId: Uuid; readonly revisionId: Uuid; readonly canonicalDigest: string },
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
    readonly checkpointBytes: string;
    readonly checkpointDigest: string;
    readonly versionVector: string;
  };
}

async function replica(
  pageId: Uuid,
  checkpoint: Awaited<ReturnType<typeof activate>>,
): Promise<OperationalPageDocument> {
  return await OperationalPageDocument.fromSnapshotTransport({
    pageId,
    snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
    snapshotDigest: checkpoint.checkpointDigest,
    versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
  });
}

async function transportUpdate(
  transaction: ReturnType<OperationalPageDocument["transact"]>,
): Promise<PageOperationUpdateDto> {
  return {
    updateId: generateUuidV7(),
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt: currentTime.toISOString(),
  };
}

async function sync(input: {
  readonly pageId: Uuid;
  readonly headers: Record<string, string>;
  readonly replica: OperationalPageDocument;
  readonly knownServerPageSequence: number;
  readonly updates?: readonly PageOperationUpdateDto[];
}): Promise<ActivePageSyncResponseDto> {
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${input.pageId}/sync`,
    headers: input.headers,
    payload: {
      mode: "active",
      requestId: generateUuidV7(),
      operationalVersion: 1,
      persistedVersionVector: Buffer.from(input.replica.versionVectorBytes()).toString("base64url"),
      knownServerPageSequence: input.knownServerPageSequence,
      updates: input.updates ?? [],
      maxRemoteBytes: MAX_PAGE_UPDATE_BATCH_BYTES,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ActivePageSyncResponseDto;
}

async function importRemoteUpdates(
  target: OperationalPageDocument,
  response: ActivePageSyncResponseDto,
  seen: Set<string>,
): Promise<void> {
  const payloads = response.remoteUpdates.map((update) => ({
    update,
    bytes: Buffer.from(update.updateBytes, "base64url"),
  }));
  const digests = await Promise.all(payloads.map(async ({ bytes }) => await sha256Hex(bytes)));
  for (const [index, { update }] of payloads.entries()) {
    expect(seen.has(update.updateId)).toBe(false);
    seen.add(update.updateId);
    expect(digests[index]).toBe(update.updateDigest);
  }
  expect(target.importUpdates(payloads.map(({ bytes }) => bytes)).pending).toBe(false);
}

async function catchUp(input: {
  readonly pageId: Uuid;
  readonly headers: Record<string, string>;
  readonly replica: OperationalPageDocument;
  readonly knownServerPageSequence: number;
  readonly firstUpdates?: readonly PageOperationUpdateDto[];
}): Promise<{
  readonly acknowledged: ActivePageSyncResponseDto;
  readonly first: ActivePageSyncResponseDto;
  readonly remoteUpdateIds: ReadonlySet<string>;
  readonly rounds: number;
}> {
  const remoteUpdateIds = new Set<string>();
  let rounds = 1;
  let response = await sync({
    pageId: input.pageId,
    headers: input.headers,
    replica: input.replica,
    knownServerPageSequence: input.knownServerPageSequence,
    ...(input.firstUpdates === undefined ? {} : { updates: input.firstUpdates }),
  });
  const first = response;
  await importRemoteUpdates(input.replica, response, remoteUpdateIds);

  while (response.hasMore) {
    rounds += 1;
    response = await sync({
      pageId: input.pageId,
      headers: input.headers,
      replica: input.replica,
      knownServerPageSequence: response.throughPageSequence,
    });
    await importRemoteUpdates(input.replica, response, remoteUpdateIds);
  }

  const acknowledged = await sync({
    pageId: input.pageId,
    headers: input.headers,
    replica: input.replica,
    knownServerPageSequence: response.throughPageSequence,
  });
  expect(acknowledged.remoteUpdates).toEqual([]);
  expect(acknowledged.hasMore).toBe(false);
  return { acknowledged, first, remoteUpdateIds, rounds };
}

async function closeRevisionWindow(pageId: Uuid): Promise<void> {
  await harness.api.built.database.db.execute(sql`
    UPDATE page_operation_states
       SET revision_window_started_at = NULL,
           revision_window_last_update_at = NULL,
           revision_window_frontier_envelope_id = NULL
     WHERE page_id = ${pageId}::uuid
  `);
}

async function withPeakLiveHeap<T>(run: (sample: () => void) => Promise<T>): Promise<{
  readonly value: T;
  readonly peakLiveGrowthBytes: number;
}> {
  Bun.gc(true);
  const baseline = process.memoryUsage().heapUsed;
  let peakLive = baseline;
  const sample = (): void => {
    Bun.gc(true);
    peakLive = Math.max(peakLive, process.memoryUsage().heapUsed);
  };
  const value = await run(sample);
  sample();
  return { value, peakLiveGrowthBytes: Math.max(0, peakLive - baseline) };
}

function checkpoints() {
  const service = harness.api.built.pageCheckpoints;
  if (service === undefined) throw new Error("page checkpoint service is unavailable");
  return service;
}

describe("operational page synchronization reference performance (T190)", () => {
  it(`ingests, catches up and compacts ${UPDATE_COUNT.toLocaleString("en-US")} updates within runner budgets`, async () => {
    const onlineHeaders = await harness.authenticate();
    const returningHeaders = await harness.authenticateAsDevice({
      deviceId: RETURNING_DEVICE_ID,
      name: "Returning performance tablet",
    });
    const page = await harness.createLegacyPage("Page operation performance");
    const checkpoint = await activate(page, onlineHeaders);
    const online = await replica(page.itemId, checkpoint);
    const returning = await replica(page.itemId, checkpoint);

    await sync({
      pageId: page.itemId,
      headers: onlineHeaders,
      replica: online,
      knownServerPageSequence: 0,
    });
    await sync({
      pageId: page.itemId,
      headers: returningHeaders,
      replica: returning,
      knownServerPageSequence: 0,
    });

    const returningBlockId = generateUuidV7();
    const returningUpdate = await transportUpdate(
      returning.transact([
        {
          type: "insert-block",
          block: {
            type: "paragraph",
            id: returningBlockId,
            content: [{ text: "Written while this device was away" }],
          },
          parentBlockId: null,
          beforeBlockId: null,
        },
      ]),
    );

    const onlineBlockId = generateUuidV7();
    let knownOnlineSequence = 0;
    const batchDurations: number[] = [];
    const measured = await withPeakLiveHeap(async (sampleLiveHeap) => {
      const ingestStarted = performance.now();
      let pending: Array<ReturnType<OperationalPageDocument["transact"]>> = [];
      for (let index = 0; index < UPDATE_COUNT; index += 1) {
        pending.push(
          index === 0
            ? online.transact([
                {
                  type: "insert-block",
                  block: {
                    type: "paragraph",
                    id: onlineBlockId,
                    content: [{ text: "0" }],
                  },
                  parentBlockId: null,
                  beforeBlockId: null,
                },
              ])
            : online.transact([
                {
                  type: "replace-text",
                  blockId: onlineBlockId,
                  from: 0,
                  to: 1,
                  text: String(index % 2),
                },
              ]),
        );

        if (pending.length === MAX_PAGE_UPDATES_PER_SYNC || index === UPDATE_COUNT - 1) {
          const updates = await Promise.all(pending.map(transportUpdate));
          const batchStarted = performance.now();
          const response = await sync({
            pageId: page.itemId,
            headers: onlineHeaders,
            replica: online,
            knownServerPageSequence: knownOnlineSequence,
            updates,
          });
          batchDurations.push(performance.now() - batchStarted);
          expect(response.accepted).toHaveLength(updates.length);
          expect(response.repeated).toEqual([]);
          expect(response.remoteUpdates).toEqual([]);
          knownOnlineSequence = response.throughPageSequence;
          pending = [];
        }
      }
      const ingestDurationMs = performance.now() - ingestStarted;
      sampleLiveHeap();

      const catchUpStarted = performance.now();
      const returningResult = await catchUp({
        pageId: page.itemId,
        headers: returningHeaders,
        replica: returning,
        knownServerPageSequence: 0,
        firstUpdates: [returningUpdate],
      });
      const catchUpDurationMs = performance.now() - catchUpStarted;
      sampleLiveHeap();

      const onlineResult = await catchUp({
        pageId: page.itemId,
        headers: onlineHeaders,
        replica: online,
        knownServerPageSequence: knownOnlineSequence,
      });
      sampleLiveHeap();

      const candidate = await checkpoints().createCandidate(page.itemId);
      await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
      sampleLiveHeap();
      await closeRevisionWindow(page.itemId);
      backupVerified = true;
      historyReleased = true;
      const compactionStarted = performance.now();
      const compaction = await checkpoints().compact(page.itemId, candidate.id as Uuid);
      const compactionDurationMs = performance.now() - compactionStarted;
      sampleLiveHeap();

      return {
        ingestDurationMs,
        catchUpDurationMs,
        compactionDurationMs,
        returningResult,
        onlineResult,
        candidate,
        compaction,
      };
    });

    const {
      ingestDurationMs,
      catchUpDurationMs,
      compactionDurationMs,
      returningResult,
      onlineResult,
      candidate,
      compaction,
    } = measured.value;
    expect(knownOnlineSequence).toBe(UPDATE_COUNT);
    expect(returningResult.first.accepted).toContainEqual(
      expect.objectContaining({
        updateId: returningUpdate.updateId,
        pageSequence: UPDATE_COUNT + 1,
      }),
    );
    expect(returningResult.remoteUpdateIds.size).toBe(UPDATE_COUNT);
    expect(returningResult.acknowledged.throughPageSequence).toBe(UPDATE_COUNT + 1);
    expect(returningResult.rounds).toBeLessThanOrEqual(
      Math.ceil((UPDATE_COUNT + 1) / MAX_PAGE_UPDATES_PER_SYNC) + 1,
    );
    expect(onlineResult.remoteUpdateIds).toEqual(new Set([returningUpdate.updateId]));
    expect(onlineResult.acknowledged.throughPageSequence).toBe(UPDATE_COUNT + 1);
    expect(candidate.throughPageSequence).toBe(UPDATE_COUNT + 1);
    expect(compaction).toEqual({
      kind: "compacted",
      checkpointId: candidate.id,
      throughPageSequence: UPDATE_COUNT + 1,
      compactedUpdates: UPDATE_COUNT + 1,
    });

    const [onlineProjection, returningProjection] = await Promise.all([
      online.project(),
      returning.project(),
    ]);
    expect(canonicalDocumentJsonV3(returningProjection.document)).toBe(
      canonicalDocumentJsonV3(onlineProjection.document),
    );
    expect(
      versionVectorBytesEqual(returning.versionVectorBytes(), online.versionVectorBytes()),
    ).toBe(true);
    expect(new Set(onlineProjection.document.blocks.map(({ id }) => id))).toEqual(
      new Set([onlineBlockId, returningBlockId]),
    );

    const stored = await harness.api.built.database.db.execute(sql`
      SELECT count(*) AS receipts,
             count(updates.update_envelope_id) AS retained_payloads,
             count(DISTINCT updates.id) AS distinct_receipts,
             state.last_update_sequence,
             checkpoint.through_page_sequence AS replay_checkpoint_sequence
        FROM page_operation_updates updates
        JOIN page_operation_states state ON state.page_id = updates.page_id
        JOIN page_operation_checkpoints checkpoint ON checkpoint.id = state.current_checkpoint_id
       WHERE updates.page_id = ${page.itemId}::uuid
       GROUP BY state.last_update_sequence, checkpoint.through_page_sequence
    `);
    const row = (
      stored as unknown as {
        rows: Array<{
          receipts: string;
          retained_payloads: string;
          distinct_receipts: string;
          last_update_sequence: string;
          replay_checkpoint_sequence: string;
        }>;
      }
    ).rows[0];
    expect(Number(row?.receipts)).toBe(UPDATE_COUNT + 1);
    expect(Number(row?.distinct_receipts)).toBe(UPDATE_COUNT + 1);
    expect(Number(row?.retained_payloads)).toBe(0);
    expect(Number(row?.last_update_sequence)).toBe(UPDATE_COUNT + 1);
    expect(
      Number(row?.last_update_sequence) - Number(row?.replay_checkpoint_sequence),
    ).toBeLessThanOrEqual(PAGE_OPERATION_REPLAY_CHECKPOINT_INTERVAL);

    const sortedBatchDurations = [...batchDurations].sort((left, right) => left - right);
    const p95BatchDurationMs =
      sortedBatchDurations[
        Math.min(sortedBatchDurations.length - 1, Math.floor(sortedBatchDurations.length * 0.95))
      ] ?? 0;
    console.info(
      `[perf] page operations ${UPDATE_COUNT} updates: ingest=${ingestDurationMs.toFixed(1)}ms batchP95=${p95BatchDurationMs.toFixed(1)}ms catchUp=${catchUpDurationMs.toFixed(1)}ms rounds=${returningResult.rounds} compact=${compactionDurationMs.toFixed(1)}ms peakLiveHeapGrowth=${(measured.peakLiveGrowthBytes / 1024 / 1024).toFixed(1)}MiB`,
    );

    expect(ingestDurationMs).toBeLessThan(MAX_INGEST_DURATION_MS);
    expect(catchUpDurationMs).toBeLessThan(MAX_CATCH_UP_DURATION_MS);
    expect(compactionDurationMs).toBeLessThan(MAX_COMPACTION_DURATION_MS);
    expect(measured.peakLiveGrowthBytes).toBeLessThan(MAX_PEAK_LIVE_HEAP_GROWTH_BYTES);
  }, 600_000);
});
