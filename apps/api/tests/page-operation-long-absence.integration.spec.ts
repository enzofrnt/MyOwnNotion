/** Long-offline convergence, replay checkpoints and safe compaction (T192/T216, US5). */

import type { ActivePageSyncResponseDto, PageOperationUpdateDto } from "@myownnotion/contracts";
import { canonicalDocumentJsonV3, generateUuidV7, type Uuid } from "@myownnotion/domain";
import {
  OperationalPageDocument,
  sha256Hex,
  versionVectorBytesEqual,
} from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PageCheckpointRetentionPolicy } from "../src/page-state/checkpoint-service.ts";
import { PAGE_OPERATION_REPLAY_CHECKPOINT_INTERVAL } from "../src/page-state/page-operation-service.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
  PAGE_OPERATION_DEVICE_ID,
} from "./helpers/authenticated-page-operations.ts";

const ABSENT_DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000de" as Uuid;
const DAY_MS = 24 * 60 * 60 * 1_000;
const ONLINE_UPDATE_COUNT = 10_000;
const MAX_UPDATES_PER_SYNC = 64;

let currentTime = new Date("2026-01-01T00:00:00.000Z");
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
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  currentTime = new Date("2026-01-01T00:00:00.000Z");
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
      maxRemoteBytes: 1024 * 1024,
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
  for (const update of response.remoteUpdates) {
    expect(seen.has(update.updateId)).toBe(false);
    seen.add(update.updateId);
    const bytes = Buffer.from(update.updateBytes, "base64url");
    expect(await sha256Hex(bytes)).toBe(update.updateDigest);
    expect(target.importUpdate(bytes).pending).toBe(false);
  }
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
}> {
  const remoteUpdateIds = new Set<string>();
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
    response = await sync({
      pageId: input.pageId,
      headers: input.headers,
      replica: input.replica,
      knownServerPageSequence: response.throughPageSequence,
    });
    await importRemoteUpdates(input.replica, response, remoteUpdateIds);
  }

  // Importing the last response only changes IndexedDB/client state. This
  // explicit empty acknowledgement proves that the durable server frontier is
  // advanced before compaction is ever allowed.
  const acknowledged = await sync({
    pageId: input.pageId,
    headers: input.headers,
    replica: input.replica,
    knownServerPageSequence: response.throughPageSequence,
  });
  expect(acknowledged.remoteUpdates).toEqual([]);
  expect(acknowledged.hasMore).toBe(false);
  return { acknowledged, first, remoteUpdateIds };
}

function checkpoints() {
  const service = harness.api.built.pageCheckpoints;
  if (service === undefined) throw new Error("page checkpoint service is unavailable");
  return service;
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

describe("long-offline operational convergence", () => {
  it("merges an authorized device after 90 days and 10,000 remote changes without unsafe compaction", async () => {
    const onlineHeaders = await harness.authenticate();
    let absentHeaders = await harness.authenticateAsDevice({
      deviceId: ABSENT_DEVICE_ID,
      name: "Long-offline tablet",
    });
    const page = await harness.createLegacyPage("Long-offline convergence");
    const checkpoint = await activate(page, onlineHeaders);
    const online = await replica(page.itemId, checkpoint);
    const absent = await replica(page.itemId, checkpoint);

    await sync({
      pageId: page.itemId,
      headers: onlineHeaders,
      replica: online,
      knownServerPageSequence: 0,
    });
    await sync({
      pageId: page.itemId,
      headers: absentHeaders,
      replica: absent,
      knownServerPageSequence: 0,
    });

    const absentBlockId = generateUuidV7();
    const absentTransaction = absent.transact([
      {
        type: "insert-block",
        block: {
          type: "paragraph",
          id: absentBlockId,
          content: [{ text: "Written on the tablet while offline" }],
        },
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    const absentUpdate = await transportUpdate(absentTransaction);

    const onlineBlockId = generateUuidV7();
    let knownOnlineSequence = 0;
    let acceptedOnlineUpdates = 0;
    let pendingTransactions: Array<ReturnType<OperationalPageDocument["transact"]>> = [];
    for (let index = 0; index < ONLINE_UPDATE_COUNT; index += 1) {
      const transaction =
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
            ]);
      expect(transaction.changed).toBe(true);
      pendingTransactions.push(transaction);

      if (
        pendingTransactions.length === MAX_UPDATES_PER_SYNC ||
        index === ONLINE_UPDATE_COUNT - 1
      ) {
        const updates = await Promise.all(pendingTransactions.map(transportUpdate));
        const response = await sync({
          pageId: page.itemId,
          headers: onlineHeaders,
          replica: online,
          knownServerPageSequence: knownOnlineSequence,
          updates,
        });
        expect(response.accepted).toHaveLength(updates.length);
        expect(response.repeated).toEqual([]);
        expect(response.remoteUpdates).toEqual([]);
        acceptedOnlineUpdates += response.accepted.length;
        knownOnlineSequence = response.throughPageSequence;
        pendingTransactions = [];
      }
    }
    expect(acceptedOnlineUpdates).toBe(ONLINE_UPDATE_COUNT);
    expect(knownOnlineSequence).toBe(ONLINE_UPDATE_COUNT);

    const storedBeforeReturn = await harness.api.built.database.db.execute(sql`
      SELECT count(*) AS total_updates,
             count(DISTINCT updates.id) AS distinct_updates,
             state.last_update_sequence,
             checkpoint.through_page_sequence AS replay_checkpoint_sequence
        FROM page_operation_updates updates
        JOIN page_operation_states state ON state.page_id = updates.page_id
        JOIN page_operation_checkpoints checkpoint ON checkpoint.id = state.current_checkpoint_id
       WHERE updates.page_id = ${page.itemId}::uuid
       GROUP BY state.last_update_sequence, checkpoint.through_page_sequence
    `);
    const beforeReturn = (
      storedBeforeReturn as unknown as {
        rows: Array<{
          total_updates: string;
          distinct_updates: string;
          last_update_sequence: string;
          replay_checkpoint_sequence: string;
        }>;
      }
    ).rows[0];
    expect(Number(beforeReturn?.total_updates)).toBe(ONLINE_UPDATE_COUNT);
    expect(Number(beforeReturn?.distinct_updates)).toBe(ONLINE_UPDATE_COUNT);
    expect(Number(beforeReturn?.last_update_sequence)).toBe(ONLINE_UPDATE_COUNT);
    expect(
      Number(beforeReturn?.last_update_sequence) - Number(beforeReturn?.replay_checkpoint_sequence),
    ).toBeLessThanOrEqual(PAGE_OPERATION_REPLAY_CHECKPOINT_INTERVAL);

    currentTime = new Date(currentTime.getTime() + 90 * DAY_MS);
    const staleCandidate = await checkpoints().createCandidate(page.itemId);
    expect(staleCandidate.throughPageSequence).toBe(ONLINE_UPDATE_COUNT);
    await checkpoints().verifyCandidate(page.itemId, staleCandidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    backupVerified = true;
    historyReleased = true;
    await expect(checkpoints().compact(page.itemId, staleCandidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "device-frontier-behind",
      deviceIds: [ABSENT_DEVICE_ID],
    });

    absentHeaders = await harness.reauthenticateAsDevice({ deviceId: ABSENT_DEVICE_ID });
    const absentReturn = await catchUp({
      pageId: page.itemId,
      headers: absentHeaders,
      replica: absent,
      knownServerPageSequence: 0,
      firstUpdates: [absentUpdate],
    });
    expect(absentReturn.first.accepted).toContainEqual(
      expect.objectContaining({ updateId: absentUpdate.updateId, pageSequence: 10_001 }),
    );
    expect(absentReturn.first.ambiguities).toEqual([]);
    expect(absentReturn.remoteUpdateIds.size).toBe(ONLINE_UPDATE_COUNT);
    expect(absentReturn.acknowledged.throughPageSequence).toBe(10_001);

    const refreshedOnlineHeaders = await harness.reauthenticateAsDevice({
      deviceId: PAGE_OPERATION_DEVICE_ID,
    });
    const onlineReturn = await catchUp({
      pageId: page.itemId,
      headers: refreshedOnlineHeaders,
      replica: online,
      knownServerPageSequence: knownOnlineSequence,
    });
    expect(onlineReturn.remoteUpdateIds).toEqual(new Set([absentUpdate.updateId]));
    expect(onlineReturn.acknowledged.throughPageSequence).toBe(10_001);

    const [onlineProjection, absentProjection] = await Promise.all([
      online.project(),
      absent.project(),
    ]);
    expect(canonicalDocumentJsonV3(absentProjection.document)).toBe(
      canonicalDocumentJsonV3(onlineProjection.document),
    );
    expect(absentProjection.canonicalDigest).toBe(onlineProjection.canonicalDigest);
    expect(versionVectorBytesEqual(absent.versionVectorBytes(), online.versionVectorBytes())).toBe(
      true,
    );
    expect(new Set(onlineProjection.document.blocks.map(({ id }) => id))).toEqual(
      new Set([onlineBlockId, absentBlockId]),
    );

    const ambiguityCount = await harness.api.built.database.db.execute(sql`
      SELECT count(*) AS total
        FROM page_ambiguities
       WHERE page_id = ${page.itemId}::uuid AND status = 'open'
    `);
    expect(
      Number((ambiguityCount as unknown as { rows: Array<{ total: string }> }).rows[0]?.total),
    ).toBe(0);

    // A shallow snapshot made before the absent branch returned cannot become
    // the new replay base. Build one from the converged 10,001-update state.
    const convergedCandidate = await checkpoints().createCandidate(page.itemId);
    expect(convergedCandidate.throughPageSequence).toBe(10_001);
    await checkpoints().verifyCandidate(page.itemId, convergedCandidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    await expect(
      checkpoints().compact(page.itemId, convergedCandidate.id as Uuid),
    ).resolves.toEqual({
      kind: "compacted",
      checkpointId: convergedCandidate.id,
      throughPageSequence: 10_001,
      compactedUpdates: 10_001,
    });

    const repeated = await sync({
      pageId: page.itemId,
      headers: absentHeaders,
      replica: absent,
      knownServerPageSequence: 10_001,
      updates: [absentUpdate],
    });
    expect(repeated.accepted).toEqual([]);
    expect(repeated.repeated).toContainEqual(
      expect.objectContaining({ updateId: absentUpdate.updateId, pageSequence: 10_001 }),
    );

    const storedAfterCompaction = await harness.api.built.database.db.execute(sql`
      SELECT count(*) AS receipts,
             count(update_envelope_id) AS retained_payloads,
             count(DISTINCT id) AS distinct_receipts
        FROM page_operation_updates
       WHERE page_id = ${page.itemId}::uuid
    `);
    const afterCompaction = (
      storedAfterCompaction as unknown as {
        rows: Array<{
          receipts: string;
          retained_payloads: string;
          distinct_receipts: string;
        }>;
      }
    ).rows[0];
    expect(Number(afterCompaction?.receipts)).toBe(10_001);
    expect(Number(afterCompaction?.distinct_receipts)).toBe(10_001);
    expect(Number(afterCompaction?.retained_payloads)).toBe(0);
  }, 600_000);
});
