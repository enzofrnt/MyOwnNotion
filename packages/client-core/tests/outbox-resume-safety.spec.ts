import {
  applyCommandToProjection,
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  type LocalMutationInput,
  type LocalRecordCodec,
  LocalRepository,
  Outbox,
  openLocalDatabase,
} from "@myownnotion/client-core";
import {
  type DatabaseDefinition,
  generateUuidV7,
  type MutationCommand,
  previewDefinitionImpact,
  type Uuid,
} from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProjectionWrite } from "../src/outbox/apply-to-projection.ts";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let items: LocalRepository;
let databases: LocalDatabaseRepository;
const now = () => new Date("2026-10-07T12:00:00.000Z");

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Missing fixture");
  return value;
}

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`outbox-resume-${generateUuidV7()}`);
  items = new LocalRepository(db, codec);
  databases = new LocalDatabaseRepository(db, codec);
  await db.meta.put({ key: "projectionComplete", value: false });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

async function apply(commandType: string, payload: Record<string, unknown>) {
  return await applyLocalMutation(
    db,
    { mutationId: generateUuidV7(), commandType, payload, baseRevisionIds: [] },
    now,
    codec,
  );
}

async function snapshot() {
  return await Promise.all(db.tables.map((table) => table.toArray()));
}

async function source() {
  const payload = {
    id: generateUuidV7(),
    name: "Local projects",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Local table",
  };
  expect((await apply("database.create", payload)).ok).toBe(true);
  return required(await databases.getDatabase(payload.id));
}

async function entry(databaseId: Uuid) {
  const id = generateUuidV7();
  expect(
    (
      await apply("database.entry.create", {
        databaseId,
        id,
        title: "Unsent entry",
        values: {},
        relationTargets: {},
      })
    ).ok,
  ).toBe(true);
  return required(await items.getItem(id));
}

async function definitionWithText() {
  const database = await source();
  const propertyId = generateUuidV7();
  const definition: DatabaseDefinition = {
    ...database.definition,
    properties: [
      ...database.definition.properties,
      {
        id: propertyId,
        type: "text",
        name: "Unsent note",
        positionKey: "b",
        state: "active",
        config: {},
      },
    ],
  };
  expect(
    (
      await apply("database.definition.replace", {
        databaseId: database.itemId,
        baseRevisionId: database.definitionRevisionId,
        definition,
      })
    ).ok,
  ).toBe(true);
  return { database: required(await databases.getDatabase(database.itemId)), propertyId };
}

describe("pending local intentions during incomplete startup (FR-005)", () => {
  it("keeps favourite and offline intentions ordered, encrypted and replayable after restart", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    const inputs: LocalMutationInput[] = [
      {
        mutationId: generateUuidV7(),
        commandType: "item.favourite",
        payload: { itemId: local.id, favourite: true },
        baseRevisionIds: [local.currentRevisionId],
      },
      {
        mutationId: generateUuidV7(),
        commandType: "item.offline",
        payload: { itemId: local.id, offline: true },
        baseRevisionIds: [local.currentRevisionId],
      },
    ];
    const revisions: (readonly Uuid[])[] = [];
    for (const input of inputs) {
      // Explicitly exercise the public default clock used by callers that do
      // not inject a test clock; pending timestamps must remain valid.
      const applied = await applyLocalMutation(db, input, undefined, codec);
      expect(applied.ok).toBe(true);
      if (applied.ok) revisions.push(applied.value.localRevisionIds);
    }
    const before = await snapshot();
    const name = db.name;
    db.close();
    db = openLocalDatabase(name);
    items = new LocalRepository(db, codec);
    for (const [index, input] of inputs.entries()) {
      const replay = await applyLocalMutation(db, input, now, codec);
      expect(replay).toMatchObject({ ok: true, value: { localRevisionIds: revisions[index] } });
    }
    expect(await snapshot()).toEqual(before);
    expect(await items.getItem(local.id)).toMatchObject({ favourite: true, offlineIntent: true });
    const pending = await new Outbox(db, codec).pending();
    expect(pending.slice(-2).map((row) => row.commandType)).toEqual([
      "item.favourite",
      "item.offline",
    ]);
    expect(pending.slice(-2).every((row) => !Number.isNaN(Date.parse(row.createdAt)))).toBe(true);
    expect(await db.outbox.get(required(inputs[0]).mutationId)).toHaveProperty("sealedPayload");
  });

  it.each([
    "database.entry.create",
    "database.entry.values.replace",
    "database.definition.replace",
  ])(
    "refuses %s before its source arrives without disturbing existing pending commands",
    async (commandType) => {
      const known = await source();
      await entry(known.itemId);
      const missingId = generateUuidV7();
      const before = await snapshot();
      const payload =
        commandType === "database.entry.create"
          ? {
              databaseId: missingId,
              id: generateUuidV7(),
              title: "Wait for source",
              values: {},
              relationTargets: {},
            }
          : commandType === "database.entry.values.replace"
            ? {
                databaseId: missingId,
                entryId: generateUuidV7(),
                baseRevisionId: generateUuidV7(),
                values: {},
                relationTargets: {},
              }
            : {
                databaseId: missingId,
                baseRevisionId: generateUuidV7(),
                definition: { ...known.definition, databaseId: missingId },
              };
      expect(await apply(commandType, payload)).toMatchObject({
        ok: false,
        error: { code: "database.not-found" },
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("reconstructs a not-yet-received membership for an already known direct child", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    await db.databaseEntryPairs.delete(`${database.itemId}:${local.id}`);
    expect(
      await apply("database.entry.values.replace", {
        databaseId: database.itemId,
        entryId: local.id,
        baseRevisionId: local.currentRevisionId,
        values: {},
        relationTargets: {},
      }),
    ).toMatchObject({ ok: true });
    expect(await databases.getEntry(local.id)).toMatchObject({
      databaseId: database.itemId,
      valueVersion: 1,
      values: { preserved: [] },
    });
    expect(await new Outbox(db, codec).pending()).toHaveLength(3);
  });

  it.each(["missing item", "moved item", "stale revision", "offloaded values"])(
    "keeps an unsent edit intact when the next edit sees %s",
    async (state) => {
      const database = await source();
      const local = await entry(database.itemId);
      let baseRevisionId = local.currentRevisionId;
      if (state === "missing item") await db.items.delete(local.id);
      if (state === "moved item") {
        const placement = required(await db.placements.where("itemId").equals(local.id).first());
        await db.placements.update(placement.id, { parentItemId: null, parentKey: "root" });
      }
      if (state === "stale revision") baseRevisionId = generateUuidV7();
      if (state === "offloaded values")
        await db.databaseEntryPairs.update(`${database.itemId}:${local.id}`, {
          availability: "offloaded",
          sealedValues: null,
        });
      const before = await snapshot();
      const code =
        state === "stale revision"
          ? "revision.stale-base"
          : state === "offloaded values"
            ? "database.projection-unavailable"
            : "database.entry-not-found";
      expect(
        await apply("database.entry.values.replace", {
          databaseId: database.itemId,
          entryId: local.id,
          baseRevisionId,
          values: {},
          relationTargets: {},
        }),
      ).toMatchObject({ ok: false, error: { code } });
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["missing", "foreign"])("refuses values against a %s secondary source", async (state) => {
    const database = await source();
    const local = await entry(database.itemId);
    const sourceId = generateUuidV7();
    const membership = required(await databases.getEntry(local.id));
    await databases.putEntry({ ...membership, sourceId });
    if (state === "foreign")
      await db.databaseSources.put(
        await codec.sealDatabase({ ...database, itemId: generateUuidV7(), sourceId }),
      );
    const before = await snapshot();
    expect(
      await apply("database.entry.values.replace", {
        databaseId: database.itemId,
        entryId: local.id,
        baseRevisionId: local.currentRevisionId,
        values: {},
        relationTargets: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "database.source-unavailable" } });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a relation that exceeds cardinality while keeping pending values", async () => {
    const database = await source();
    const propertyId = generateUuidV7();
    const definition: DatabaseDefinition = {
      ...database.definition,
      properties: [
        ...database.definition.properties,
        {
          id: propertyId,
          name: "One target",
          type: "relation",
          positionKey: "b",
          state: "active",
          config: { cardinality: "one" },
        },
      ],
    };
    expect(
      (
        await apply("database.definition.replace", {
          databaseId: database.itemId,
          baseRevisionId: database.definitionRevisionId,
          definition,
        })
      ).ok,
    ).toBe(true);
    const local = await entry(database.itemId);
    const before = await snapshot();
    expect(
      await apply("database.entry.values.replace", {
        databaseId: database.itemId,
        entryId: local.id,
        baseRevisionId: local.currentRevisionId,
        values: {},
        relationTargets: { [propertyId]: [generateUuidV7(), generateUuidV7()] },
      }),
    ).toMatchObject({ ok: false, error: { code: "validation.invalid-payload" } });
    expect(await snapshot()).toEqual(before);
  });

  it.each(["missing", "stale", "confirmed"])(
    "checks %s destructive-schema confirmation against local unsent values",
    async (confirmation) => {
      const { database, propertyId } = await definitionWithText();
      const local = await entry(database.itemId);
      expect(
        (
          await apply("database.entry.values.replace", {
            databaseId: database.itemId,
            entryId: local.id,
            baseRevisionId: local.currentRevisionId,
            values: { [propertyId]: { kind: "text", value: "Unsent private note" } },
            relationTargets: {},
          })
        ).ok,
      ).toBe(true);
      const values = required(await databases.getEntry(local.id));
      const candidate: DatabaseDefinition = {
        ...database.definition,
        properties: database.definition.properties.map((property) =>
          property.id === propertyId ? { ...property, state: "retired" } : property,
        ),
      };
      const impact = await previewDefinitionImpact({
        baseRevisionId: required(database.definitionRevisionId),
        current: database.definition,
        candidate,
        entries: [values.values],
      });
      expect(impact.destructive).toBe(true);
      const before = await snapshot();
      const result = await apply("database.definition.replace", {
        databaseId: database.itemId,
        baseRevisionId: database.definitionRevisionId,
        definition: candidate,
        ...(confirmation === "missing"
          ? {}
          : {
              impactConfirmation: {
                digest: confirmation === "stale" ? "0".repeat(64) : impact.impactDigest,
                decision: "preserve-incompatible",
              },
            }),
      });
      if (confirmation === "confirmed") {
        expect(result.ok).toBe(true);
        expect(
          (await databases.getDatabase(database.itemId))?.definition.properties.find(
            (property) => property.id === propertyId,
          )?.state,
        ).toBe("retired");
        expect((await databases.getEntry(local.id))?.values).toEqual(values.values);
        expect(await new Outbox(db, codec).pending()).toHaveLength(5);
      } else {
        expect(result).toMatchObject({
          ok: false,
          error: {
            code:
              confirmation === "missing"
                ? "database.impact-confirmation-required"
                : "database.impact-stale",
          },
        });
        expect(await snapshot()).toEqual(before);
      }
    },
  );

  it("refuses a schema preview while a known membership lacks its sealed values", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    await db.databaseEntryPairs.update(`${database.itemId}:${local.id}`, { sealedValues: null });
    const before = await snapshot();
    expect(
      await apply("database.definition.replace", {
        databaseId: database.itemId,
        baseRevisionId: database.definitionRevisionId,
        definition: { ...database.definition, name: "Next name" },
      }),
    ).toMatchObject({ ok: false, error: { code: "database.projection-unavailable" } });
    expect(await snapshot()).toEqual(before);
  });

  it("keeps older conflict records from preventing unrelated entry eviction", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    await db.outbox.clear();
    await db.conflicts.put(
      (await codec.sealConflict({
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId: generateUuidV7(), name: "Other unsent edit" },
        baseRevisionIds: [],
        localRevisionIds: [],
        competingRevisionIds: [generateUuidV7()],
        capturedAt: now().toISOString(),
        errorCode: "revision.stale-base",
      })) as never,
    );
    expect(await databases.offloadEntryValues(local.id)).toBe(true);
    expect(await db.conflicts.count()).toBe(1);
    expect(await databases.getEntry(local.id)).toMatchObject({ availability: "offloaded" });
  });

  it("updates an unsent relation index without removing unrelated links", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    const propertyId = generateUuidV7();
    const definition: DatabaseDefinition = {
      ...database.definition,
      properties: [
        ...database.definition.properties,
        {
          id: propertyId,
          name: "Related",
          type: "relation",
          positionKey: "b",
          state: "active",
          config: { cardinality: "many" },
        },
      ],
    };
    expect(
      (
        await apply("database.definition.replace", {
          databaseId: database.itemId,
          baseRevisionId: database.definitionRevisionId,
          definition,
        })
      ).ok,
    ).toBe(true);
    const unrelatedId = generateUuidV7();
    const oldLinkId = generateUuidV7();
    await db.relationships.bulkPut([
      {
        id: oldLinkId,
        sourceItemId: local.id,
        targetItemId: database.itemId,
        relationType: "database:property",
        metadata: { databaseId: database.itemId, propertyId },
      },
      {
        id: unrelatedId,
        sourceItemId: local.id,
        targetItemId: database.itemId,
        relationType: "reference",
        metadata: {},
      },
    ]);
    expect(
      (
        await apply("database.entry.values.replace", {
          databaseId: database.itemId,
          entryId: local.id,
          baseRevisionId: local.currentRevisionId,
          values: {},
          relationTargets: { [propertyId]: [] },
        })
      ).ok,
    ).toBe(true);
    expect(await db.relationships.get(oldLinkId)).toBeUndefined();
    expect(await db.relationships.get(unrelatedId)).toMatchObject({ relationType: "reference" });
    expect(await databases.getRelationTargets(database.itemId, local.id)).toEqual({});
    expect(await new Outbox(db, codec).pending()).toHaveLength(4);
  });

  it("allows editing a locally created linked view during partial discovery", async () => {
    const database = await source();
    const parent = await entry(database.itemId);
    const id = generateUuidV7();
    expect(
      (
        await apply("database_view.create", {
          id,
          name: "Linked locally",
          sourceId: database.sourceId,
          placement: { id: generateUuidV7(), parentItemId: parent.id, positionKey: "b" },
          initialViewId: generateUuidV7(),
        })
      ).ok,
    ).toBe(true);
    const linked = required(await databases.getDatabase(id));
    const presentation = required(linked.presentation);
    expect(
      (
        await apply("database.presentation.replace", {
          containerItemId: id,
          baseRevisionId: linked.presentationRevisionId,
          presentation: {
            ...presentation,
            views: presentation.views.map((view) => ({ ...view, name: "Edited locally" })),
          },
        })
      ).ok,
    ).toBe(true);
    expect(await databases.getDatabase(id)).toMatchObject({
      presentationVersion: 2,
      presentation: { views: [expect.objectContaining({ name: "Edited locally" })] },
    });
    expect(await new Outbox(db, codec).pending()).toHaveLength(4);
  });

  it("rejects a folder carrying editorial content before recording an intention", async () => {
    const database = await source();
    const before = await snapshot();
    expect(
      await apply("database.entry.create", {
        databaseId: database.itemId,
        id: generateUuidV7(),
        title: "Invalid folder",
        kind: "folder",
        document: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
        values: {},
        relationTargets: {},
      }),
    ).toMatchObject({ ok: false, error: { code: "validation.invalid-payload" } });
    expect(await snapshot()).toEqual(before);
  });
});

describe("atomic guards after asynchronous preparation", () => {
  async function rejectAfterPreparation(
    command: MutationCommand,
    alter: () => Promise<unknown>,
    code: string,
  ) {
    const prepared = await prepareProjectionWrite(db, command, codec);
    await alter();
    const before = await snapshot();
    await expect(
      db.transaction(
        "rw",
        db.tables,
        async () => await applyCommandToProjection(db, command, now, prepared, generateUuidV7()),
      ),
    ).rejects.toMatchObject({ code });
    expect(await snapshot()).toEqual(before);
  }

  it.each(["item", "definition"])(
    "does not overwrite a %s already received for a newly prepared database",
    async (state) => {
      const database = await source();
      const command: MutationCommand = {
        type: "database.create",
        id: database.itemId,
        name: "Duplicate",
        placement: { id: generateUuidV7(), parentItemId: null, positionKey: "b" },
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Duplicate view",
      };
      if (state === "definition") await db.items.delete(database.itemId);
      await rejectAfterPreparation(command, async () => undefined, "database.membership-conflict");
    },
  );

  it("rolls back a revision when a secondary source identity appears before commit", async () => {
    const database = await source();
    const sourceId = generateUuidV7();
    await rejectAfterPreparation(
      {
        type: "database.source.create",
        ownerItemId: database.itemId,
        sourceId,
        name: "Second source",
        baseRevisionId: required(database.presentationRevisionId),
        titlePropertyId: generateUuidV7(),
        initialViewId: generateUuidV7(),
        initialViewName: "Second table",
      },
      async () => await db.databaseSources.put(await codec.sealDatabase({ ...database, sourceId })),
      "mutation.duplicate",
    );
  });

  it("refuses a definition whose source disappears before commit", async () => {
    const database = await source();
    await rejectAfterPreparation(
      {
        type: "database.definition.replace",
        databaseId: database.itemId,
        baseRevisionId: required(database.definitionRevisionId),
        definition: { ...database.definition, name: "Unsaved next name" },
      },
      async () => await db.databases.delete(database.itemId),
      "database.not-found",
    );
  });

  it.each(["membership", "item", "inactive owner"])(
    "refuses a prepared entry after receiving a competing %s",
    async (state) => {
      const database = await source();
      const local = await entry(database.itemId);
      const id = state === "inactive owner" ? generateUuidV7() : local.id;
      if (state === "membership") await db.items.delete(local.id);
      await rejectAfterPreparation(
        {
          type: "database.entry.create",
          databaseId: database.itemId,
          id,
          title: "Prepared draft",
          values: {},
          relationTargets: {},
        },
        async () =>
          state === "inactive owner"
            ? await db.items.update(database.itemId, { lifecycle: "trashed" })
            : undefined,
        state === "inactive owner" ? "database.source-unavailable" : "database.membership-conflict",
      );
    },
  );

  it("preserves existing pending commands when a move references an orphaned placement", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    const placement = required(await db.placements.where("itemId").equals(local.id).first());
    await db.items.delete(local.id);
    const before = await snapshot();
    expect(
      await apply("placement.move", {
        placementId: placement.id,
        parentItemId: null,
        positionKey: "z",
      }),
    ).toMatchObject({ ok: false, error: { code: "item.not-found" } });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses removing the document-owned link through a generic relation command", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    const relationshipId = generateUuidV7();
    await db.relationships.put({
      id: relationshipId,
      sourceItemId: local.id,
      targetItemId: database.itemId,
      relationType: "page:link",
      metadata: {},
    });
    const before = await snapshot();
    expect(await apply("relationship.remove", { relationshipId })).toMatchObject({
      ok: false,
      error: { code: "validation.invalid-payload" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("returns the durable winner when the mutation was committed during sealing", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    const input: LocalMutationInput = {
      mutationId: generateUuidV7(),
      commandType: "item.rename",
      payload: { itemId: local.id, name: "Winner from another context" },
      baseRevisionIds: [local.currentRevisionId],
    };
    const command: MutationCommand = {
      type: "item.rename",
      itemId: local.id,
      name: "Winner from another context",
    };
    const winner = await prepareProjectionWrite(db, command, codec);
    const seal = codec.sealOutbox.bind(codec);
    let winnerRevisionIds: Uuid[] = [];
    let committed: Awaited<ReturnType<typeof snapshot>> = [];
    vi.spyOn(codec, "sealOutbox").mockImplementationOnce(async (row) => {
      const stored = await seal(row);
      // Publish an actual atomic projection + outbox winner, rather than
      // mocking the second get() to claim a commit that never happened.
      await db.transaction("rw", db.tables, async () => {
        winnerRevisionIds = await applyCommandToProjection(
          db,
          command,
          now,
          winner,
          input.mutationId,
        );
        await db.outbox.add({
          ...stored,
          enqueueOrder: 3,
          localRevisionIds: winnerRevisionIds,
        } as never);
      });
      committed = await snapshot();
      return stored;
    });
    expect(await applyLocalMutation(db, input, now, codec)).toMatchObject({
      ok: true,
      value: { localRevisionIds: [winner.revisionId] },
    });
    expect(winnerRevisionIds).toEqual([winner.revisionId]);
    expect(await snapshot()).toEqual(committed);
    expect(await items.getItem(local.id)).toMatchObject({
      name: "Winner from another context",
      currentRevisionId: winner.revisionId,
    });
  });

  it.each(["missing", "trashed", "file"])(
    "refuses a linked view under a %s parent without replacing pending work",
    async (state) => {
      const database = await source();
      const local = await entry(database.itemId);
      if (state === "missing") await db.items.delete(local.id);
      if (state === "trashed") await db.items.update(local.id, { lifecycle: "trashed" });
      if (state === "file") {
        const current = required(await items.getItem(local.id));
        await db.items.put(
          await codec.sealItem({
            ...current,
            kind: "file",
            pageDocument: null,
            file: { mediaType: "text/plain", originalName: "cache.txt", byteLength: 1 },
          }),
        );
      }
      const before = await snapshot();
      expect(
        await apply("database_view.create", {
          id: generateUuidV7(),
          name: "Linked view",
          sourceId: database.sourceId,
          placement: { id: generateUuidV7(), parentItemId: local.id, positionKey: "b" },
          initialViewId: generateUuidV7(),
        }),
      ).toMatchObject({ ok: false, error: { code: "item.not-found" } });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("refuses icons for cached files without altering the unsent entry mutation", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    await db.items.put(
      await codec.sealItem({
        ...local,
        kind: "file",
        pageDocument: null,
        file: { mediaType: "text/plain", originalName: "cache.txt", byteLength: 1 },
      }),
    );
    const before = await snapshot();
    expect(await apply("item.icon", { itemId: local.id, icon: "📁" })).toMatchObject({
      ok: false,
      error: { code: "item.wrong-kind" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("restores a legacy trash group using timestamps when its revision headers have not arrived", async () => {
    const database = await source();
    const local = await entry(database.itemId);
    expect((await apply("item.trash", { itemId: database.itemId })).ok).toBe(true);
    await db.revisionHeaders.clear();
    expect((await apply("item.restore", { itemId: database.itemId })).ok).toBe(true);
    expect(await items.getItem(database.itemId)).toMatchObject({ lifecycle: "active" });
    expect(await items.getItem(local.id)).toMatchObject({ lifecycle: "active" });
    expect(await new Outbox(db, codec).pending()).toHaveLength(4);
    expect(await db.revisionHeaders.count()).toBe(2);
  });
});

describe("older local projection metadata during resume", () => {
  it("keeps edits useful when a legacy definition and membership lack source identities", async () => {
    const database = await source();
    await db.databases.put(
      await codec.sealDatabase({
        itemId: database.itemId,
        definitionVersion: 1,
        definition: database.definition,
      }),
    );
    await db.databaseSources.clear();
    const baseRevisionId = required(await items.getItem(database.itemId)).currentRevisionId;
    expect(
      (
        await apply("database.definition.replace", {
          databaseId: database.itemId,
          baseRevisionId,
          definition: { ...database.definition, name: "Legacy edit" },
        })
      ).ok,
    ).toBe(true);
    const local = await entry(database.itemId);
    const membership = required(await databases.getEntry(local.id));
    await databases.putEntry({
      databaseId: membership.databaseId,
      entryItemId: membership.entryItemId,
      valueVersion: membership.valueVersion,
      availability: "present",
      values: membership.values,
    });
    expect(
      (
        await apply("database.entry.values.replace", {
          databaseId: database.itemId,
          entryId: local.id,
          baseRevisionId: local.currentRevisionId,
          values: {},
          relationTargets: {},
        })
      ).ok,
    ).toBe(true);
    expect(await databases.getEntry(local.id)).toMatchObject({
      valueVersion: 2,
      values: { preserved: [] },
    });
    expect(await new Outbox(db, codec).pending()).toHaveLength(4);
  });

  it.each([true, false])(
    "respects the independent source revision when its owner row is absent (source head: %s)",
    async (hasSourceHead) => {
      const database = await source();
      await db.items.delete(database.itemId);
      if (!hasSourceHead)
        await db.databases.put(
          await codec.sealDatabase({
            itemId: database.itemId,
            definitionVersion: database.definitionVersion,
            definition: database.definition,
          }),
        );
      const before = await snapshot();
      const result = await apply("database.definition.replace", {
        databaseId: database.itemId,
        baseRevisionId: database.definitionRevisionId,
        definition: { ...database.definition, name: "Independent source edit" },
      });
      if (hasSourceHead) {
        expect(result.ok).toBe(true);
        expect(await items.getItem(database.itemId)).toBeNull();
        expect((await databases.getDatabase(database.itemId))?.definition.name).toBe(
          "Independent source edit",
        );
        expect(await new Outbox(db, codec).pending()).toHaveLength(2);
      } else {
        expect(result).toMatchObject({ ok: false, error: { code: "database.not-found" } });
        expect(await snapshot()).toEqual(before);
      }
    },
  );

  it("initializes absent legacy presentation versions when adding, removing and renaming views", async () => {
    const database = await source();
    const { presentationVersion: _version, ...legacy } = database;
    await db.databases.put(await codec.sealDatabase(legacy));
    const sourceId = generateUuidV7();
    expect(
      (
        await apply("database.source.create", {
          ownerItemId: database.itemId,
          sourceId,
          name: "Temporary source",
          baseRevisionId: database.presentationRevisionId,
          titlePropertyId: generateUuidV7(),
          initialViewId: generateUuidV7(),
          initialViewName: "Temporary table",
        })
      ).ok,
    ).toBe(true);
    const added = required(await databases.getDatabase(database.itemId));
    const { presentationVersion: _addedVersion, ...addedLegacy } = added;
    await db.databases.put(await codec.sealDatabase(addedLegacy));
    expect(
      (
        await apply("database.source.delete", {
          ownerItemId: database.itemId,
          sourceId,
          baseRevisionId: added.presentationRevisionId,
        })
      ).ok,
    ).toBe(true);
    const removed = required(await databases.getDatabase(database.itemId));
    const { presentationVersion: _removedVersion, ...removedLegacy } = removed;
    await db.databases.put(await codec.sealDatabase(removedLegacy));
    const presentation = required(removed.presentation);
    expect(
      (
        await apply("database.presentation.replace", {
          containerItemId: database.itemId,
          baseRevisionId: removed.presentationRevisionId,
          presentation: {
            ...presentation,
            views: presentation.views.map((view) => ({ ...view, name: "Restored view" })),
          },
        })
      ).ok,
    ).toBe(true);
    expect(await databases.getDatabase(database.itemId)).toMatchObject({
      presentationVersion: 2,
      presentation: {
        views: expect.arrayContaining([
          expect.objectContaining({ name: "Restored view", state: "active" }),
        ]),
      },
    });
    expect(await new Outbox(db, codec).pending()).toHaveLength(4);
  });
});
