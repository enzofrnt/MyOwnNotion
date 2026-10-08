/** Conservative boot classification and interrupted recovery keep historical drafts authoritative. */
import {
  type ConflictRecordRow,
  EncryptedPageOperationLog,
  LegacyConflictRecovery,
  type LegacyRecoveryRevisionResult,
  LocalCipher,
  type LocalDatabase,
  type LocalRecordCodec,
  openLocalDatabase,
  PageReconciler,
} from "@myownnotion/client-core";
import {
  type BlockDocument,
  generateUuidV7,
  migrateDocumentV2ToV3,
  type Uuid,
  upgradeLegacyBody,
} from "@myownnotion/domain";
import { verifyLegacyOfflineBranch } from "@myownnotion/page-state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

const context = {
  installationId: "018f2b7c-0000-7000-8000-000000000001",
  workspaceId: "018f2b7c-0000-7000-8000-0000000000aa",
};
let db: LocalDatabase;
let codec: LocalRecordCodec;
let log: EncryptedPageOperationLog;
let revisions: Map<Uuid, LegacyRecoveryRevisionResult>;
let loadRevision: ReturnType<typeof vi.fn<(id: Uuid) => Promise<LegacyRecoveryRevisionResult>>>;

beforeEach(async () => {
  const fixture = await createTestCodec();
  codec = fixture.codec;
  db = openLocalDatabase(`legacy-recovery-startup-${generateUuidV7()}`);
  log = new EncryptedPageOperationLog(db, new LocalCipher(fixture.keys), context);
  revisions = new Map();
  loadRevision = vi.fn(
    async (id: Uuid) =>
      revisions.get(id) ?? {
        ok: false,
        offline: false,
        code: "revision.snapshot-expired",
      },
  );
});

afterEach(async () => {
  await db.delete();
});

function recovery() {
  return new LegacyConflictRecovery({ db, codec, log, loadRevision });
}

function document(blockId = generateUuidV7(), text = "Retained private draft"): BlockDocument {
  return { blocks: [{ id: blockId, type: "paragraph", content: [{ text }] }] };
}

async function seedConflict(
  options: {
    readonly payload?: Record<string, unknown>;
    readonly base?: BlockDocument;
    readonly capturedAt?: string;
  } = {},
) {
  const pageId = generateUuidV7();
  const blockId = generateUuidV7();
  const base = options.base ?? document(blockId, "Ancestor");
  const local = migrateDocumentV2ToV3({
    blocks: [
      ...base.blocks,
      { id: generateUuidV7(), type: "paragraph", content: [{ text: "Retained private draft" }] },
    ],
  });
  const baseRevisionId = generateUuidV7();
  const conflict: ConflictRecordRow = {
    mutationId: generateUuidV7(),
    commandType: "page.document.replace",
    payload: {
      itemId: pageId,
      baseRevisionId,
      document: { format: "myownnotion.document+json", formatVersion: 3, body: local },
      ...options.payload,
    },
    baseRevisionIds: [baseRevisionId],
    localRevisionIds: [],
    competingRevisionIds: [generateUuidV7()],
    capturedAt: options.capturedAt ?? "2026-10-07T10:00:00.000Z",
    errorCode: "revision.stale-base",
  };
  await db.conflicts.put((await codec.sealConflict(conflict)) as unknown as ConflictRecordRow);
  await db.items.put(
    await codec.sealItem({
      id: pageId,
      kind: "page",
      name: "Historical page",
      icon: null,
      lifecycle: "active",
      currentRevisionId: generateUuidV7(),
      trashedAt: null,
      purgeAfter: null,
      favourite: false,
      offlineIntent: true,
      localAvailability: "present",
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: local.blocks },
      },
      file: null,
    }),
  );
  revisions.set(baseRevisionId, {
    ok: true,
    value: {
      id: baseRevisionId,
      itemId: pageId,
      snapshot: {
        pageDocument: { format: "myownnotion.document+json", formatVersion: 2, body: base },
      },
    },
  });
  return { pageId, baseRevisionId, conflict, base, local };
}

async function expectRetained(conflict: ConflictRecordRow) {
  expect(await recovery().retainedConflict(conflict.mutationId)).toEqual(conflict);
  expect(JSON.stringify(await db.conflicts.get(conflict.mutationId))).not.toContain(
    "Retained private draft",
  );
}

describe("legacy conflict startup recovery", () => {
  it("classifies unsupported or unroutable historical documents without networking or deleting their content", async () => {
    const unreadableRoute = await seedConflict({ payload: { itemId: "not-a-uuid" } });
    const unsupported = await seedConflict({
      payload: {
        document: {
          format: "myownnotion.document+json",
          formatVersion: 3,
          body: { blocks: "malformed", privateText: "Retained private draft" },
        },
      },
    });
    const ignored = await seedConflict();
    await db.conflicts.update(ignored.conflict.mutationId, { commandType: "item.rename" });
    const service = recovery();
    await expect(service.classify()).resolves.toEqual({ classified: 2, quarantined: 2 });
    expect(await service.list(["quarantined"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mutationId: unreadableRoute.conflict.mutationId,
          pageId: null,
          reasonCode: "legacy-recovery.item-not-page",
        }),
        expect.objectContaining({
          mutationId: unsupported.conflict.mutationId,
          pageId: unsupported.pageId,
          reasonCode: "legacy-recovery.schema-unsupported",
        }),
      ]),
    );
    await expect(service.classify()).resolves.toEqual({ classified: 0, quarantined: 0 });
    expect(loadRevision).not.toHaveBeenCalled();
    await expectRetained(unreadableRoute.conflict);
    await expectRetained(unsupported.conflict);
    expect(await db.conflicts.count()).toBe(3);
    expect(await service.retainedConflict(generateUuidV7())).toBeNull();
  });

  it("uses retained revision routing when an older payload omitted its item identity", async () => {
    const fixture = await seedConflict({ payload: { itemId: undefined } });
    await db.revisionHeaders.put({
      id: fixture.baseRevisionId,
      itemId: fixture.pageId,
      mutationId: fixture.conflict.mutationId,
      parentRevisionIds: [],
      local: 0,
      acceptedAt: fixture.conflict.capturedAt,
    });
    await expect(recovery().recoverAvailable()).resolves.toMatchObject({
      prepared: 1,
      quarantined: 0,
      pageIds: [fixture.pageId],
    });
    const branch = await log.getLegacyBranch(fixture.pageId);
    expect(branch).not.toBeNull();
    if (branch === null) throw new Error("missing recovered branch");
    expect((await verifyLegacyOfflineBranch(branch.branch)).document).toEqual(fixture.local);
    await expectRetained({
      ...fixture.conflict,
      payload: { ...fixture.conflict.payload, itemId: undefined },
    });
  });

  it.each(["purged", "converted to folder", "foreign local key"])(
    "quarantines a previously classified page after it is %s without fetching its ancestor",
    async (change) => {
      const fixture = await seedConflict();
      const service = recovery();
      await service.classify();
      const stored = await db.items.get(fixture.pageId);
      if (stored === undefined) throw new Error("missing item fixture");
      const opened = await codec.openItem(stored);
      if (change === "purged") await db.items.delete(fixture.pageId);
      else if (change === "converted to folder")
        await db.items.put(await codec.sealItem({ ...opened, kind: "folder", pageDocument: null }));
      else {
        const otherDevice = await createTestCodec();
        await db.items.put(await otherDevice.codec.sealItem(opened));
      }
      await expect(service.recoverAvailable()).resolves.toMatchObject({
        prepared: 0,
        quarantined: 1,
      });
      expect(await db.legacySyncRecoveries.get(fixture.conflict.mutationId)).toMatchObject({
        status: "quarantined",
        reasonCode:
          change === "foreign local key"
            ? "legacy-recovery.integrity-failed"
            : "legacy-recovery.item-not-page",
      });
      expect(loadRevision).not.toHaveBeenCalled();
      await expectRetained(fixture.conflict);
    },
  );

  it("quarantines a classified source whose ciphertext can no longer be opened without deleting it", async () => {
    const fixture = await seedConflict();
    const service = recovery();
    await service.classify();
    const otherDevice = await createTestCodec();
    const foreignSource = await otherDevice.codec.sealConflict(fixture.conflict);
    await db.conflicts.put(foreignSource as unknown as ConflictRecordRow);
    await expect(service.recoverAvailable()).resolves.toMatchObject({ quarantined: 1 });
    expect(await db.legacySyncRecoveries.get(fixture.conflict.mutationId)).toMatchObject({
      reasonCode: "legacy-recovery.payload-unreadable",
    });
    expect(await db.conflicts.get(fixture.conflict.mutationId)).toEqual(foreignSource);
    expect(await service.retainedConflict(fixture.conflict.mutationId)).toBeNull();
    expect(loadRevision).not.toHaveBeenCalled();
  });

  it("does not recreate a conflict removed by the owner after its classification", async () => {
    const fixture = await seedConflict();
    const service = recovery();
    await service.classify();
    await db.conflicts.delete(fixture.conflict.mutationId);
    await expect(service.recoverAvailable()).resolves.toMatchObject({
      quarantined: 1,
      prepared: 0,
    });
    expect(await db.legacySyncRecoveries.get(fixture.conflict.mutationId)).toMatchObject({
      reasonCode: "legacy-recovery.integrity-failed",
    });
    expect(await db.conflicts.count()).toBe(0);
    expect(await log.getLegacyBranch(fixture.pageId)).toBeNull();
    expect(loadRevision).not.toHaveBeenCalled();
  });

  it.each(["valid payload fallback", "unavailable identity"])(
    "handles an older conflict without revision routing: %s",
    async (caseName) => {
      const fixture = await seedConflict();
      const historical: ConflictRecordRow = {
        ...fixture.conflict,
        baseRevisionIds: [],
        payload: {
          ...fixture.conflict.payload,
          ...(caseName === "unavailable identity"
            ? { baseRevisionId: "old-unidentified-base" }
            : {}),
        },
      };
      await db.conflicts.put(
        (await codec.sealConflict(historical)) as unknown as ConflictRecordRow,
      );
      const outcome = await recovery().recoverAvailable();
      expect(outcome).toMatchObject({
        prepared: caseName === "valid payload fallback" ? 1 : 0,
        quarantined: caseName === "unavailable identity" ? 1 : 0,
      });
      if (caseName === "unavailable identity") {
        expect(loadRevision).not.toHaveBeenCalled();
        expect(await db.legacySyncRecoveries.get(historical.mutationId)).toMatchObject({
          reasonCode: "legacy-recovery.base-unavailable",
        });
      } else {
        expect(loadRevision).toHaveBeenCalledExactlyOnceWith(fixture.baseRevisionId);
        const branch = await log.getLegacyBranch(fixture.pageId);
        if (branch === null) throw new Error("missing payload-fallback branch");
        expect((await verifyLegacyOfflineBranch(branch.branch)).document).toEqual(fixture.local);
      }
      await expectRetained(historical);
    },
  );

  it.each(["inline equation", "equation block", "nested quote style", "checkbox style"])(
    "does not discard v3-only ancestor content when preparing recovery (%s)",
    async (kind) => {
      const fixture = await seedConflict();
      const equation = {
        type: "equation" as const,
        equationId: generateUuidV7(),
        expression: "x + y",
      };
      const styled = [{ text: "Ancestor", marks: [{ type: "underline" as const }] }];
      const ancestor = {
        blocks:
          kind === "equation block"
            ? [{ type: "equation", id: generateUuidV7(), expression: "x + y" }]
            : kind === "inline equation"
              ? [
                  {
                    type: "paragraph",
                    id: generateUuidV7(),
                    content: [{ text: "x + y", marks: [equation] }],
                  },
                ]
              : kind === "nested quote style"
                ? [
                    {
                      type: "quote",
                      id: generateUuidV7(),
                      content: [],
                      children: [{ type: "paragraph", id: generateUuidV7(), content: styled }],
                    },
                  ]
                : [
                    {
                      type: "checkbox",
                      id: generateUuidV7(),
                      checked: true,
                      content: styled,
                      children: [],
                    },
                  ],
      };
      revisions.set(fixture.baseRevisionId, {
        ok: true,
        value: {
          id: fixture.baseRevisionId,
          itemId: fixture.pageId,
          snapshot: {
            pageDocument: { format: "myownnotion.document+json", formatVersion: 3, body: ancestor },
          },
        },
      });
      await expect(recovery().recoverAvailable()).resolves.toMatchObject({
        prepared: 0,
        quarantined: 1,
      });
      expect(await db.legacySyncRecoveries.get(fixture.conflict.mutationId)).toMatchObject({
        reasonCode: "legacy-recovery.schema-unsupported",
      });
      await expectRetained(fixture.conflict);
      expect(await log.getLegacyBranch(fixture.pageId)).toBeNull();
    },
  );

  it.each([
    "retention expired",
    "foreign page",
    "null snapshot",
    "array snapshot",
    "invalid v2",
    "future version",
  ])("retains a complete draft when ancestor evidence has %s", async (failure) => {
    const fixture = await seedConflict();
    if (failure === "retention expired") revisions.delete(fixture.baseRevisionId);
    else
      revisions.set(fixture.baseRevisionId, {
        ok: true,
        value: {
          id: fixture.baseRevisionId,
          itemId: failure === "foreign page" ? generateUuidV7() : fixture.pageId,
          snapshot:
            failure === "null snapshot"
              ? null
              : failure === "array snapshot"
                ? []
                : {
                    pageDocument: {
                      format: "myownnotion.document+json",
                      formatVersion: failure === "future version" ? 99 : 2,
                      body: { blocks: "malformed" },
                    },
                  },
        },
      });
    await expect(recovery().recoverAvailable()).resolves.toMatchObject({
      quarantined: 1,
      prepared: 0,
    });
    expect(await db.legacySyncRecoveries.get(fixture.conflict.mutationId)).toMatchObject({
      reasonCode:
        failure === "retention expired"
          ? "legacy-recovery.base-unavailable"
          : failure === "foreign page"
            ? "legacy-recovery.integrity-failed"
            : "legacy-recovery.schema-unsupported",
    });
    expect(loadRevision).toHaveBeenCalledExactlyOnceWith(fixture.baseRevisionId);
    expect(await log.getLegacyBranch(fixture.pageId)).toBeNull();
    await expectRetained(fixture.conflict);
  });

  it.each(["legacy body", "block body"])(
    "recovers a valid historical v1 %s without dropping its local intention",
    async (kind) => {
      const legacyBody = { text: "Ancient private content" };
      const base = kind === "legacy body" ? upgradeLegacyBody(legacyBody) : document();
      const fixture = await seedConflict({ base });
      revisions.set(fixture.baseRevisionId, {
        ok: true,
        value: {
          id: fixture.baseRevisionId,
          itemId: fixture.pageId,
          snapshot: {
            pageDocument: {
              format: "myownnotion.document+json",
              formatVersion: 1,
              body: kind === "legacy body" ? legacyBody : base,
            },
          },
        },
      });
      await expect(recovery().recoverAvailable()).resolves.toMatchObject({
        prepared: 1,
        quarantined: 0,
      });
      const branch = await log.getLegacyBranch(fixture.pageId);
      if (branch === null) throw new Error("missing legacy conversion branch");
      expect((await verifyLegacyOfflineBranch(branch.branch)).document).toEqual(fixture.local);
      await expectRetained(fixture.conflict);
    },
  );

  it("keeps a converting draft when the server refuses its handover, with no repeated ancestor reads", async () => {
    const fixture = await seedConflict();
    const service = recovery();
    await service.recoverAvailable();
    const branchBefore = await log.getLegacyBranch(fixture.pageId);
    expect(branchBefore).not.toBeNull();
    const convert = vi.fn(async () => ({
      ok: false as const,
      offline: false,
      problem: { code: "item.not-found", message: "The server page was purged" },
    }));
    await expect(
      new PageReconciler({
        pageId: fixture.pageId,
        log,
        transport: {
          async sync() {
            throw new Error("No active page should be requested");
          },
          convertLegacyBranch: convert,
        },
      }).convertLegacyBranch(),
    ).resolves.toMatchObject({ kind: "blocked" });
    await expect(service.recoverAvailable()).resolves.toMatchObject({
      quarantined: 1,
      prepared: 0,
      pageIds: [],
    });
    expect(await db.legacySyncRecoveries.get(fixture.conflict.mutationId)).toMatchObject({
      reasonCode: "legacy-recovery.base-unavailable",
    });
    expect((await log.getLegacyBranch(fixture.pageId))?.branch.localDocument).toEqual(
      fixture.local,
    );
    await expectRetained(fixture.conflict);
    expect(loadRevision).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledTimes(1);
  });
});
