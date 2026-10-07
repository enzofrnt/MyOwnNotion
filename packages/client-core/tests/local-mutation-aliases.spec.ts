import {
  applyLocalMutation,
  type LocalDatabase,
  type LocalMutationInput,
  type LocalRecordCodec,
  LocalRepository,
  type LocalRevisionHeaderRow,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let outbox: Outbox;

const now = () => new Date("2026-10-07T12:00:00.000Z");

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`aliases-${generateUuidV7()}`);
  outbox = new Outbox(db, codec);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

function alias(id: Uuid, canonicalRevisionId: Uuid): LocalRevisionHeaderRow {
  return {
    id,
    canonicalRevisionId,
    itemId: generateUuidV7(),
    mutationId: generateUuidV7(),
    parentRevisionIds: [],
    acceptedAt: now().toISOString(),
    local: 0,
  };
}

function createInput(baseRevisionIds: Uuid[] = []): LocalMutationInput {
  return {
    mutationId: generateUuidV7(),
    commandType: "item.create",
    payload: {
      id: generateUuidV7(),
      kind: "folder",
      name: "Local command",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    },
    baseRevisionIds,
  };
}

async function snapshotCounts() {
  return {
    items: await db.items.count(),
    placements: await db.placements.count(),
    outbox: await db.outbox.count(),
    revisions: await db.revisionHeaders.count(),
  };
}

describe("command-scoped revision aliases", () => {
  it("rebases an acknowledged caller without scanning unrelated revision history", async () => {
    const created = createInput();
    const creation = await applyLocalMutation(db, created, now, codec);
    expect(creation.ok).toBe(true);
    if (!creation.ok) throw new Error("Creation failed");
    const localRevisionId = creation.value.localRevisionIds[0] as Uuid;
    const canonicalRevisionId = generateUuidV7();
    await outbox.acknowledge(created.mutationId, [canonicalRevisionId]);
    await db.revisionHeaders.bulkAdd(
      Array.from({ length: 2048 }, () => alias(generateUuidV7(), generateUuidV7())),
    );

    const fullScan = vi
      .spyOn(db.revisionHeaders, "toArray")
      .mockRejectedValue(new Error("Unrelated history must not be read"));
    const lookup = vi.spyOn(db.revisionHeaders, "bulkGet");
    const mutationId = generateUuidV7();
    const itemId = created.payload["id"] as Uuid;
    const edited = await applyLocalMutation(
      db,
      {
        mutationId,
        commandType: "item.rename",
        payload: { itemId, name: "After acknowledgement", baseRevisionId: localRevisionId },
        baseRevisionIds: [localRevisionId, localRevisionId],
      },
      now,
      codec,
    );

    expect(edited.ok).toBe(true);
    expect(fullScan).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledExactlyOnceWith([localRevisionId]);
    expect(await outbox.get(mutationId)).toMatchObject({
      baseRevisionIds: [canonicalRevisionId, canonicalRevisionId],
      payload: { baseRevisionId: canonicalRevisionId },
    });
    expect((await new LocalRepository(db, codec).getItem(itemId))?.name).toBe(
      "After acknowledgement",
    );
  });

  it("remaps the supported payload references once and preserves command ordering", async () => {
    const first = generateUuidV7();
    const second = generateUuidV7();
    const third = generateUuidV7();
    const unrelated = generateUuidV7();
    const missing = generateUuidV7();
    const canonicalSecond = generateUuidV7();
    const canonicalThird = generateUuidV7();
    await db.revisionHeaders.bulkAdd([
      alias(first, second),
      alias(second, canonicalSecond),
      alias(third, canonicalThird),
      alias(unrelated, generateUuidV7()),
    ]);
    const lookup = vi.spyOn(db.revisionHeaders, "bulkGet");
    const input = createInput([first, missing, first]);
    const payload = {
      ...input.payload,
      baseRevisionId: first,
      currentRevisionId: second,
      resolvedRevisionIds: [third, missing, first],
      parentRevisionIds: [second, third],
      revisionId: unrelated,
      metadata: { baseRevisionId: unrelated },
    };
    const created = await applyLocalMutation(db, { ...input, payload }, now, codec);

    expect(created.ok).toBe(true);
    expect(lookup).toHaveBeenCalledExactlyOnceWith([first, missing, second, third]);
    expect(await outbox.get(input.mutationId)).toMatchObject({
      baseRevisionIds: [second, missing, second],
      payload: {
        baseRevisionId: second,
        currentRevisionId: canonicalSecond,
        resolvedRevisionIds: [canonicalThird, missing, second],
        parentRevisionIds: [canonicalSecond, canonicalThird],
        revisionId: unrelated,
        metadata: { baseRevisionId: unrelated },
      },
    });
    expect(payload.baseRevisionId).toBe(first);
    expect(payload.resolvedRevisionIds).toEqual([third, missing, first]);
  });

  it.each([
    { commandType: "document.resolve-conflict", field: "resolvedRevisionIds", array: true },
    { commandType: "page.document.replace", field: "baseRevisionId", array: false },
  ])(
    "leaves invalid $field values to command validation",
    async ({ commandType, field, array }) => {
      const referenced = generateUuidV7();
      await db.revisionHeaders.add(alias(referenced, generateUuidV7()));
      const lookup = vi.spyOn(db.revisionHeaders, "bulkGet");
      const before = await snapshotCounts();
      const result = await applyLocalMutation(
        db,
        {
          mutationId: generateUuidV7(),
          commandType,
          payload: {
            itemId: generateUuidV7(),
            document: {
              format: "myownnotion.document+json",
              formatVersion: 1,
              body: { blocks: [] },
            },
            [field]: array ? [referenced, { invalid: true }, null, 42] : { invalid: true },
          },
          baseRevisionIds: [],
        },
        now,
        codec,
      );

      expect(result).toMatchObject({ ok: false, error: { code: "validation.invalid-payload" } });
      expect(lookup).toHaveBeenCalledExactlyOnceWith(array ? [referenced] : []);
      expect(await snapshotCounts()).toEqual(before);
    },
  );

  it("retains atomic projection and outbox rollback after resolving an alias", async () => {
    const referenced = generateUuidV7();
    await db.revisionHeaders.add(alias(referenced, generateUuidV7()));
    const before = await snapshotCounts();
    const quotaError = new Error("Quota exceeded");
    quotaError.name = "QuotaExceededError";
    vi.spyOn(db.outbox, "add").mockRejectedValue(quotaError);

    const result = await applyLocalMutation(db, createInput([referenced]), now, codec);

    expect(result).toMatchObject({ ok: false, error: { code: "storage.quota-exceeded" } });
    expect(await snapshotCounts()).toEqual(before);
  });
});
