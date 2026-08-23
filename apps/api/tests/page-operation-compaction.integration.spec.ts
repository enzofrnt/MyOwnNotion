/** Verified checkpoints, device frontiers and lossless compaction (T125, US5). */

import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { OperationalPageDocument, sha256Hex } from "@myownnotion/page-state";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PageCheckpointRetentionPolicy } from "../src/page-state/checkpoint-service.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
  PAGE_OPERATION_DEVICE_ID,
} from "./helpers/authenticated-page-operations.ts";

const ABSENT_DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000dd" as Uuid;
const TEST_DIGEST = "a".repeat(64);

let backupVerified = false;
let historyReleased = false;
const retention: PageCheckpointRetentionPolicy = {
  checkpointIsInVerifiedBackup: async () => backupVerified,
  historyAllowsCompaction: async () => historyReleased,
};
let harness: AuthenticatedPageOperationHarness;

beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness({ checkpointRetention: retention });
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  backupVerified = false;
  historyReleased = false;
  await harness.reset();
});

function checkpoints() {
  const service = harness.api.built.pageCheckpoints;
  if (service === undefined) throw new Error("page checkpoint service is unavailable");
  return service;
}

async function activate(
  page: { itemId: Uuid; revisionId: Uuid; canonicalDigest: string },
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

async function createAcceptedUpdate() {
  const headers = await harness.authenticate();
  const page = await harness.createLegacyPage();
  const checkpoint = await activate(page, headers);
  const author = await OperationalPageDocument.fromSnapshotTransport({
    pageId: page.itemId,
    snapshotBytes: Buffer.from(checkpoint.checkpointBytes, "base64url"),
    snapshotDigest: checkpoint.checkpointDigest,
    versionVector: Buffer.from(checkpoint.versionVector, "base64url"),
  });
  const transaction = author.transact([
    {
      type: "insert-block",
      block: {
        type: "paragraph",
        id: generateUuidV7(),
        content: [{ text: "Durable offline work" }],
      },
      parentBlockId: null,
      beforeBlockId: null,
    },
  ]);
  const update = {
    updateId: generateUuidV7(),
    baseVersionVector: Buffer.from(transaction.baseVersionVector).toString("base64url"),
    updateBytes: Buffer.from(transaction.updateBytes).toString("base64url"),
    updateDigest: await sha256Hex(transaction.updateBytes),
    createdAt: "2026-08-23T00:00:00.000Z",
  };
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: `/v1/page-operations/${page.itemId}/sync`,
    headers,
    payload: {
      mode: "active",
      requestId: generateUuidV7(),
      operationalVersion: 1,
      persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString("base64url"),
      knownServerPageSequence: 0,
      updates: [update],
      maxRemoteBytes: 1024 * 1024,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { headers, page, transaction, update };
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

describe("operational checkpoint lifecycle", () => {
  it("keeps a candidate inert until its encrypted snapshot and projection are verified", async () => {
    const { page } = await createAcceptedUpdate();
    const before = await harness.api.built.database.db.execute(sql`
      SELECT current_checkpoint_id
        FROM page_operation_states
       WHERE page_id = ${page.itemId}::uuid
    `);
    const currentCheckpointId = (
      before as unknown as { rows: Array<{ current_checkpoint_id: string }> }
    ).rows[0]?.current_checkpoint_id;

    const candidate = await checkpoints().createCandidate(page.itemId);
    expect(candidate).toMatchObject({ state: "candidate", throughPageSequence: 1 });
    expect(candidate.id).not.toBe(currentCheckpointId);

    const stillCurrent = await harness.api.built.database.db.execute(sql`
      SELECT current_checkpoint_id
        FROM page_operation_states
       WHERE page_id = ${page.itemId}::uuid
    `);
    expect(
      (stillCurrent as unknown as { rows: Array<{ current_checkpoint_id: string }> }).rows[0]
        ?.current_checkpoint_id,
    ).toBe(currentCheckpointId);

    const verified = await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    expect(verified).toMatchObject({ state: "verified", throughPageSequence: 1 });
  });

  it("reuses a candidate at the same frontier and verifies it idempotently", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);

    await expect(checkpoints().createCandidate(page.itemId)).resolves.toMatchObject({
      id: candidate.id,
      state: "candidate",
    });
    const verified = await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await expect(
      checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid),
    ).resolves.toMatchObject({ id: verified.id, state: "verified" });
  });

  it("rejects a missing or superseded candidate", async () => {
    const { page } = await createAcceptedUpdate();

    await expect(checkpoints().verifyCandidate(page.itemId, generateUuidV7())).rejects.toThrow(
      /does not exist/u,
    );

    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_checkpoints
         SET state = 'superseded'
       WHERE id = ${candidate.id}::uuid
    `);
    await expect(checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid)).rejects.toThrow(
      /only a checkpoint candidate/u,
    );
  });

  it("rejects canonical state drift before sealing a candidate", async () => {
    const { page } = await createAcceptedUpdate();
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_states
         SET canonical_digest = ${TEST_DIGEST}
       WHERE page_id = ${page.itemId}::uuid
    `);

    await expect(checkpoints().createCandidate(page.itemId)).rejects.toThrow(
      /no longer matches its canonical projection/u,
    );
  });

  it("does not promote a candidate whose sealed snapshot was corrupted", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await harness.api.built.database.db.execute(sql`
      UPDATE protected_envelopes
         SET ciphertext = ciphertext || 'corrupt'
       WHERE id = ${candidate.snapshotEnvelopeId}::uuid
    `);

    await expect(
      checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid),
    ).rejects.toThrow();

    const stored = await harness.api.built.database.db.execute(sql`
      SELECT state FROM page_operation_checkpoints WHERE id = ${candidate.id}::uuid
    `);
    expect((stored as unknown as { rows: Array<{ state: string }> }).rows[0]?.state).toBe(
      "candidate",
    );
  });

  it("does not verify a candidate whose declared canonical digest was corrupted", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await harness.api.built.database.db.execute(sql`
      UPDATE page_operation_checkpoints
         SET canonical_digest = ${TEST_DIGEST}
       WHERE id = ${candidate.id}::uuid
    `);

    await expect(checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid)).rejects.toThrow(
      /failed canonical verification/u,
    );
  });
});

describe("frontier-bounded compaction", () => {
  it("refuses an unknown or unverified checkpoint", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);

    await expect(checkpoints().compact(page.itemId, generateUuidV7())).resolves.toEqual({
      kind: "blocked",
      reason: "candidate-not-verified",
    });
    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "candidate-not-verified",
    });
  });

  it("requires a checkpoint candidate ahead of the active checkpoint", async () => {
    const { page } = await createAcceptedUpdate();
    const stateResult = await harness.api.built.database.db.execute(sql`
      SELECT current_checkpoint_id
        FROM page_operation_states
       WHERE page_id = ${page.itemId}::uuid
    `);
    const currentCheckpointId = (
      stateResult as unknown as { rows: Array<{ current_checkpoint_id: Uuid }> }
    ).rows[0]?.current_checkpoint_id;
    if (currentCheckpointId === undefined) throw new Error("current checkpoint is unavailable");

    await expect(checkpoints().compact(page.itemId, currentCheckpointId)).resolves.toEqual({
      kind: "blocked",
      reason: "candidate-not-ahead",
    });
  });

  it("refuses to compact an unconsolidated revision window", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    backupVerified = true;
    historyReleased = true;

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "history-unconsolidated",
    });
  });

  it("refuses to compact until an operational backup is verified", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    historyReleased = true;

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "backup-not-verified",
    });

    const retained = await harness.api.built.database.db.execute(sql`
      SELECT update_envelope_id, compacted_at
        FROM page_operation_updates
       WHERE page_id = ${page.itemId}::uuid
    `);
    expect(
      (
        retained as unknown as {
          rows: Array<{ update_envelope_id: string; compacted_at: Date | null }>;
        }
      ).rows[0],
    ).toMatchObject({ compacted_at: null });
  });

  it("refuses to compact while visible history still retains the update", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    backupVerified = true;

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "history-retained",
    });
  });

  it("refuses to compact while a restoration is unfinished", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    backupVerified = true;
    historyReleased = true;
    const backupId = generateUuidV7();
    await harness.api.built.database.db.execute(sql`
      INSERT INTO backups
        (id, workspace_id, cursor, application_version, schema_version,
         record_format_version, byte_length, digest, reason)
      VALUES
        (${backupId}::uuid, ${harness.api.built.context.workspaceId}::uuid, '0',
         'compaction-test', 1, 1, 0, ${TEST_DIGEST}, 'manual')
    `);
    await harness.api.built.database.db.execute(sql`
      INSERT INTO restoration_attempts (id, backup_id, kind)
      VALUES (${generateUuidV7()}::uuid, ${backupId}::uuid, 'destructive')
    `);

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "restore-in-progress",
    });
  });

  it("retains source payloads while an ambiguity still depends on them", async () => {
    const { page, update } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    backupVerified = true;
    historyReleased = true;

    await harness.api.built.database.db.execute(sql`
      INSERT INTO page_ambiguities
        (id, page_id, workspace_id, logical_key, kind, details_envelope_id,
         source_update_ids, status)
      SELECT ${generateUuidV7()}::uuid, page_id, workspace_id,
             'block:retained-source', 'delete-edit', update_envelope_id,
             ARRAY[id]::uuid[], 'open'
        FROM page_operation_updates
       WHERE id = ${update.updateId}::uuid
    `);

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "ambiguity-retained",
    });
    const retained = await harness.api.built.database.db.execute(sql`
      SELECT update_envelope_id, compacted_at
        FROM page_operation_updates
       WHERE id = ${update.updateId}::uuid
    `);
    expect(
      (
        retained as unknown as {
          rows: Array<{ update_envelope_id: string; compacted_at: Date | null }>;
        }
      ).rows[0],
    ).toMatchObject({ compacted_at: null });
  });

  it("keeps an arbitrarily old authorized frontier, then compacts only after explicit revocation", async () => {
    const { headers, page, transaction, update } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    backupVerified = true;
    historyReleased = true;

    await harness.api.built.database.db.execute(sql`
      INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
      SELECT ${ABSENT_DEVICE_ID}::uuid, owner_id, 'absent-operation-device', 'Offline tablet', 'active'
        FROM authorized_devices
       WHERE id = ${PAGE_OPERATION_DEVICE_ID}::uuid
    `);
    await harness.api.built.database.db.execute(sql`
      INSERT INTO page_device_frontiers
        (page_id, device_id, workspace_id, frontier_envelope_id, frontier_digest,
         confirmed_page_sequence, record_version, last_confirmed_at, device_state)
      SELECT page_id, ${ABSENT_DEVICE_ID}::uuid, workspace_id, frontier_envelope_id,
             frontier_digest, 0, 1, '2025-01-01T00:00:00.000Z'::timestamptz, 'authorized'
        FROM page_device_frontiers
       WHERE page_id = ${page.itemId}::uuid
         AND device_id = ${PAGE_OPERATION_DEVICE_ID}::uuid
    `);

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "device-frontier-behind",
      deviceIds: [ABSENT_DEVICE_ID],
    });

    await harness.api.built.database.db.execute(sql`
      UPDATE authorized_devices
         SET state = 'revoked', revoked_at = '2026-08-23T00:00:00.000Z'::timestamptz
       WHERE id = ${ABSENT_DEVICE_ID}::uuid
    `);
    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "compacted",
      checkpointId: candidate.id,
      throughPageSequence: 1,
      compactedUpdates: 1,
    });

    const compacted = await harness.api.built.database.db.execute(sql`
      SELECT base_frontier_envelope_id, result_frontier_envelope_id,
             update_envelope_id, compacted_at
        FROM page_operation_updates
       WHERE id = ${update.updateId}::uuid
    `);
    expect(
      (
        compacted as unknown as {
          rows: Array<{
            base_frontier_envelope_id: string | null;
            result_frontier_envelope_id: string;
            update_envelope_id: string | null;
            compacted_at: Date | null;
          }>;
        }
      ).rows[0],
    ).toMatchObject({
      base_frontier_envelope_id: null,
      update_envelope_id: null,
    });
    expect(
      (
        compacted as unknown as {
          rows: Array<{ result_frontier_envelope_id: string; compacted_at: Date | null }>;
        }
      ).rows[0]?.result_frontier_envelope_id,
    ).toBeTruthy();
    expect(
      (
        compacted as unknown as {
          rows: Array<{ result_frontier_envelope_id: string; compacted_at: Date | null }>;
        }
      ).rows[0]?.compacted_at,
    ).not.toBeNull();

    const repeated = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/sync`,
      headers,
      payload: {
        mode: "active",
        requestId: generateUuidV7(),
        operationalVersion: 1,
        persistedVersionVector: Buffer.from(transaction.resultVersionVector).toString("base64url"),
        knownServerPageSequence: 1,
        updates: [update],
        maxRemoteBytes: 1024 * 1024,
      },
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().repeated).toEqual([
      expect.objectContaining({ updateId: update.updateId, pageSequence: 1 }),
    ]);

    const revokedFrontier = await harness.api.built.database.db.execute(sql`
      SELECT device_state
        FROM page_device_frontiers
       WHERE page_id = ${page.itemId}::uuid
         AND device_id = ${ABSENT_DEVICE_ID}::uuid
    `);
    expect(
      (revokedFrontier as unknown as { rows: Array<{ device_state: string }> }).rows[0]
        ?.device_state,
    ).toBe("revoked");
  });

  it("blocks a device whose sequence is current but causal frontier is behind", async () => {
    const { page } = await createAcceptedUpdate();
    const candidate = await checkpoints().createCandidate(page.itemId);
    await checkpoints().verifyCandidate(page.itemId, candidate.id as Uuid);
    await closeRevisionWindow(page.itemId);
    backupVerified = true;
    historyReleased = true;

    await harness.api.built.database.db.execute(sql`
      INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
      SELECT ${ABSENT_DEVICE_ID}::uuid, owner_id, 'causally-behind-device',
             'Causally behind tablet', 'active'
        FROM authorized_devices
       WHERE id = ${PAGE_OPERATION_DEVICE_ID}::uuid
    `);
    await harness.api.built.database.db.execute(sql`
      INSERT INTO page_device_frontiers
        (page_id, device_id, workspace_id, frontier_envelope_id, frontier_digest,
         confirmed_page_sequence, record_version, last_confirmed_at, device_state)
      SELECT state.page_id, ${ABSENT_DEVICE_ID}::uuid, state.workspace_id,
             checkpoint.frontier_envelope_id, ${TEST_DIGEST}, 1, 1,
             '2026-08-23T00:00:00.000Z'::timestamptz, 'authorized'
        FROM page_operation_states state
        JOIN page_operation_checkpoints checkpoint
          ON checkpoint.id = state.current_checkpoint_id
       WHERE state.page_id = ${page.itemId}::uuid
    `);

    await expect(checkpoints().compact(page.itemId, candidate.id as Uuid)).resolves.toEqual({
      kind: "blocked",
      reason: "device-frontier-behind",
      deviceIds: [ABSENT_DEVICE_ID],
    });
  });
});
