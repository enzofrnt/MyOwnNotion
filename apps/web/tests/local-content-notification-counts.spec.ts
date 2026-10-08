import type { ConflictRecordRow, OutboxMutationRow, OutboxStatus } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestCodec } from "../../../packages/client-core/tests/helpers/codec.ts";
import type { ContentApi } from "../src/services/content-api.ts";
import { LocalContentService } from "../src/services/local-content.ts";

let service: LocalContentService | undefined;

afterEach(async () => {
  await service?.db.delete();
  service = undefined;
});

describe("local notification counts", () => {
  it("counts sealed routing metadata without opening command or conflict contents", async () => {
    const api = {
      submitMutationBatch: async () => ({ ok: true, value: { results: [] } }),
      listChanges: async () => ({
        ok: true,
        value: { changes: [], cursor: "0", hasMore: false },
      }),
    } as unknown as ContentApi;
    service = new LocalContentService(api, `notification-counts-${generateUuidV7()}`);
    await service.initialize();
    const { codec } = await createTestCodec();
    const createdAt = new Date().toISOString();
    const statuses: OutboxStatus[] = ["pending", "sending", "blocked", "conflict"];
    for (const [index, status] of statuses.entries()) {
      const row: OutboxMutationRow = {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId: generateUuidV7(), name: "Retained private draft" },
        baseRevisionIds: [],
        localRevisionIds: [],
        status,
        createdAt,
        lastAttemptAt: null,
        enqueueOrder: index,
      };
      // Deliberately sealed with another key: these diagnostics need only the
      // routing fields, never the contents or this fixture's decryption key.
      await service.db.outbox.add((await codec.sealOutbox(row)) as unknown as OutboxMutationRow);
    }

    const activeId = generateUuidV7();
    const recoveryIds = Array.from({ length: 4 }, () => generateUuidV7());
    for (const mutationId of [activeId, ...recoveryIds]) {
      const row: ConflictRecordRow = {
        mutationId,
        commandType: "page.document.replace",
        payload: { retained: "Private conflict" },
        baseRevisionIds: [],
        localRevisionIds: [],
        competingRevisionIds: [],
        capturedAt: createdAt,
        errorCode: "mutation.conflict",
      };
      await service.db.conflicts.add(
        (await codec.sealConflict(row)) as unknown as ConflictRecordRow,
      );
    }
    for (const [index, status] of (
      ["pending", "converting", "quarantined", "converted"] as const
    ).entries()) {
      const mutationId = recoveryIds[index];
      if (mutationId === undefined) throw new Error("Missing fixture identity");
      await service.db.legacySyncRecoveries.add({
        mutationId,
        pageId: generateUuidV7(),
        branchId: null,
        status,
        reasonCode: null,
        attemptCount: 0,
        capturedAt: createdAt,
        updatedAt: createdAt,
      });
    }
    vi.spyOn(service.pageOperationLog, "countUpdates").mockResolvedValue(2);
    const openQueue = vi.spyOn(service.outbox, "all");
    const openConflicts = vi.spyOn(service.outbox, "activeConflicts");

    // A refused local mutation publishes fresh diagnostics but cannot start a
    // background drain which would legitimately need the sealed command body.
    const refused = await service.mutate("item.rename", {
      itemId: generateUuidV7(),
      name: "Missing item",
    });
    expect(refused).toMatchObject({ ok: false, error: { code: "item.not-found" } });
    expect(service.getSnapshot()).toMatchObject({
      syncState: "conflict",
      pendingCount: 7, // three workspace rows, two page updates, two recoveries
      conflictCount: 1,
      attentionCount: 2,
      recoveryPendingCount: 2,
      quarantinedRecoveryCount: 1,
    });
    expect(openQueue).not.toHaveBeenCalled();
    expect(openConflicts).not.toHaveBeenCalled();
    expect(await service.db.outbox.count()).toBe(4);
    expect(await service.db.conflicts.count()).toBe(5);

    // Resolving one conflict must update attention without decrypting the
    // retained recovery proofs, and a blocked send remains pending work.
    await service.db.conflicts.delete(activeId);
    await service.mutate("item.rename", { itemId: generateUuidV7(), name: "Still missing" });
    expect(service.getSnapshot()).toMatchObject({
      pendingCount: 7,
      conflictCount: 0,
      attentionCount: 1,
    });
  });
});
