import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  type LocalRecordCodec,
  Outbox,
  openLocalDatabase,
  type ReconcileTransport,
  reconcile,
} from "@myownnotion/client-core";
import type { QueuedMutationDto, QueuedMutationResultDto } from "@myownnotion/contracts";
import {
  type DatabaseDefinition,
  generateUuidV7,
  type NonRelationPropertyValue,
  type Uuid,
} from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let databases: LocalDatabaseRepository;

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`database-reconciliation-${generateUuidV7()}`);
  databases = new LocalDatabaseRepository(db, codec);
});

afterEach(async () => {
  await db.delete();
});

async function apply(commandType: string, payload: Record<string, unknown>) {
  const result = await applyLocalMutation(
    db,
    {
      mutationId: generateUuidV7(),
      commandType,
      payload,
      baseRevisionIds:
        typeof payload["baseRevisionId"] === "string" ? [payload["baseRevisionId"] as Uuid] : [],
    },
    () => new Date("2026-08-20T10:00:00.000Z"),
    codec,
  );
  expect(result.ok).toBe(true);
  return result;
}

const ids = () => ({
  databaseId: generateUuidV7(),
  titlePropertyId: generateUuidV7(),
  textPropertyId: generateUuidV7(),
  numberPropertyId: generateUuidV7(),
  viewId: generateUuidV7(),
});

async function seedDatabase() {
  const generated = ids();
  await apply("database.create", {
    id: generated.databaseId,
    name: "Offline database",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
    titlePropertyId: generated.titlePropertyId,
    initialViewId: generated.viewId,
    initialViewName: "Table",
  });
  const initial = await databases.getDatabase(generated.databaseId);
  const host = await db.items.get(generated.databaseId);
  if (initial === null || host === undefined) throw new Error("database seed failed");
  const openedHost = await codec.openItem(host);
  const definition: DatabaseDefinition = {
    ...initial.definition,
    properties: [
      ...initial.definition.properties,
      {
        id: generated.textPropertyId,
        name: "Text",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: generated.numberPropertyId,
        name: "Number",
        type: "number",
        positionKey: "c",
        state: "active",
        config: {},
      },
    ],
    views: initial.definition.views.map((view) => ({
      ...view,
      properties: [
        ...view.properties,
        { propertyId: generated.textPropertyId, visible: true, positionKey: "b" },
        { propertyId: generated.numberPropertyId, visible: true, positionKey: "c" },
      ],
    })),
  };
  await apply("database.definition.replace", {
    databaseId: generated.databaseId,
    baseRevisionId: openedHost.currentRevisionId,
    definition,
  });
  await db.outbox.clear();
  return { ...generated, definition };
}

class ConflictTransport implements ReconcileTransport {
  readonly submissions: QueuedMutationDto[][] = [];
  readonly revisions = new Map<Uuid, Record<string, unknown>>();

  constructor(readonly competingRevisionId: Uuid) {}

  async submitMutationBatch(mutations: QueuedMutationDto[]) {
    this.submissions.push(mutations);
    const results: QueuedMutationResultDto[] = mutations.map((mutation) =>
      this.submissions.length === 1
        ? {
            mutationId: mutation.mutationId,
            status: "conflict",
            competingRevisionIds: [this.competingRevisionId],
            problem: {
              type: "about:blank",
              title: "stale",
              status: 409,
              code: "revision.stale-base",
            },
          }
        : {
            mutationId: mutation.mutationId,
            status: "accepted",
            revisionIds: [generateUuidV7()],
          },
    );
    return { ok: true as const, value: { results } };
  }

  async listChanges(after: string) {
    return {
      ok: true as const,
      value: { changes: [], nextCursor: after, hasMore: false },
    };
  }

  async currentSnapshot() {
    return { ok: false as const, offline: false };
  }

  async getRevision(revisionId: Uuid) {
    const snapshot = this.revisions.get(revisionId);
    return snapshot === undefined
      ? { ok: false as const, offline: false }
      : { ok: true as const, value: { snapshot } as never };
  }
}

function renameProperty(definition: DatabaseDefinition, propertyId: Uuid, name: string) {
  return {
    ...definition,
    properties: definition.properties.map((property) =>
      property.id === propertyId ? { ...property, name } : property,
    ),
  };
}

describe("structured reconciliation (T072)", () => {
  it("rebases compatible definition edits on distinct stable fields", async () => {
    const seeded = await seedDatabase();
    const host = await codec.openItem((await db.items.get(seeded.databaseId)) as never);
    const ancestorRevisionId = host.currentRevisionId;
    const local = renameProperty(seeded.definition, seeded.textPropertyId, "Local text");
    const remote = {
      ...seeded.definition,
      views: seeded.definition.views.map((view) => ({ ...view, name: "Remote table" })),
    };
    await apply("database.definition.replace", {
      databaseId: seeded.databaseId,
      baseRevisionId: ancestorRevisionId,
      definition: local,
    });
    const remoteRevisionId = generateUuidV7();
    const transport = new ConflictTransport(remoteRevisionId);
    transport.revisions.set(ancestorRevisionId, { databaseDefinition: seeded.definition });
    transport.revisions.set(remoteRevisionId, { databaseDefinition: remote });

    const outcome = await reconcile(db, transport, codec);

    expect(outcome.conflicts).toBe(0);
    expect(outcome.accepted).toBe(1);
    expect(transport.submissions).toHaveLength(2);
    const mergedSubmission = transport.submissions[1]?.[0];
    if (mergedSubmission === undefined) throw new Error("merged submission missing");
    expect(mergedSubmission.mutationId).not.toBe(transport.submissions[0]?.[0]?.mutationId);
    const merged = (mergedSubmission.payload as Record<string, unknown>)[
      "definition"
    ] as DatabaseDefinition;
    expect(merged.properties.find(({ id }) => id === seeded.textPropertyId)?.name).toBe(
      "Local text",
    );
    expect(merged.views[0]?.name).toBe("Remote table");
    expect(transport.submissions[1]?.[0]?.baseRevisionIds).toEqual([remoteRevisionId]);
  });

  it("captures all definition versions when the same view field diverges", async () => {
    const seeded = await seedDatabase();
    const host = await codec.openItem((await db.items.get(seeded.databaseId)) as never);
    const ancestorRevisionId = host.currentRevisionId;
    const local = {
      ...seeded.definition,
      views: seeded.definition.views.map((view) => ({ ...view, name: "Local table" })),
    };
    const remote = {
      ...seeded.definition,
      views: seeded.definition.views.map((view) => ({ ...view, name: "Remote table" })),
    };
    await apply("database.definition.replace", {
      databaseId: seeded.databaseId,
      baseRevisionId: ancestorRevisionId,
      definition: local,
    });
    const remoteRevisionId = generateUuidV7();
    const transport = new ConflictTransport(remoteRevisionId);
    transport.revisions.set(ancestorRevisionId, { databaseDefinition: seeded.definition });
    transport.revisions.set(remoteRevisionId, { databaseDefinition: remote });

    const outcome = await reconcile(db, transport, codec);
    const [conflict] = await new Outbox(db, codec).conflicts();

    expect(outcome.conflicts).toBe(1);
    expect(transport.submissions).toHaveLength(1);
    expect(conflict?.structured).toMatchObject({
      kind: "database-definition",
      ancestor: seeded.definition,
      local,
      remote,
      conflicts: [expect.objectContaining({ reason: "divergent-edit" })],
    });
  });

  it("merges distinct entry properties and captures a same-property divergence", async () => {
    const seeded = await seedDatabase();
    const entryId = generateUuidV7();
    await apply("database.entry.create", {
      databaseId: seeded.databaseId,
      id: entryId,
      title: "Entry",
      placement: { id: generateUuidV7(), parentItemId: seeded.databaseId, positionKey: "a" },
      values: {
        [seeded.textPropertyId]: { kind: "text", value: "before" },
        [seeded.numberPropertyId]: { kind: "number", decimal: "1" },
      },
      relationTargets: {},
    });
    await db.outbox.clear();
    const entryItem = await codec.openItem((await db.items.get(entryId)) as never);
    const ancestorRevisionId = entryItem.currentRevisionId;
    const ancestor = (await databases.getEntry(entryId))?.values;
    if (ancestor === undefined) throw new Error("entry seed failed");
    const localValues: Record<Uuid, NonRelationPropertyValue> = {
      [seeded.textPropertyId]: { kind: "text", value: "local" },
      [seeded.numberPropertyId]: { kind: "number", decimal: "1" },
    };
    await apply("database.entry.values.replace", {
      databaseId: seeded.databaseId,
      entryId,
      baseRevisionId: ancestorRevisionId,
      values: localValues,
      relationTargets: {},
    });
    const remoteRevisionId = generateUuidV7();
    const remote = {
      ...ancestor,
      values: {
        [seeded.textPropertyId]: { kind: "text" as const, value: "before" },
        [seeded.numberPropertyId]: { kind: "number" as const, decimal: "2" },
      },
    };
    const transport = new ConflictTransport(remoteRevisionId);
    transport.revisions.set(ancestorRevisionId, {
      databaseEntryValues: ancestor,
      databaseRelationTargets: {},
    });
    transport.revisions.set(remoteRevisionId, {
      databaseEntryValues: remote,
      databaseRelationTargets: {},
    });

    const mergedOutcome = await reconcile(db, transport, codec);
    expect(mergedOutcome.conflicts).toBe(0);
    const mergedSubmission = transport.submissions[1]?.[0];
    if (mergedSubmission === undefined) throw new Error("merged submission missing");
    expect(mergedSubmission.mutationId).not.toBe(transport.submissions[0]?.[0]?.mutationId);
    expect((mergedSubmission.payload as Record<string, unknown>)["values"]).toEqual({
      [seeded.textPropertyId]: { kind: "text", value: "local" },
      [seeded.numberPropertyId]: { kind: "number", decimal: "2" },
    });

    // A second isolated divergence uses the same ancestor but changes the same
    // property on both devices; neither value may be chosen automatically.
    await db.outbox.clear();
    const currentItem = await codec.openItem((await db.items.get(entryId)) as never);
    const currentEntry = await databases.getEntry(entryId);
    if (currentEntry === null) throw new Error("entry missing");
    const secondAncestor = currentEntry.values;
    await apply("database.entry.values.replace", {
      databaseId: seeded.databaseId,
      entryId,
      baseRevisionId: currentItem.currentRevisionId,
      values: {
        ...secondAncestor.values,
        [seeded.textPropertyId]: { kind: "text", value: "mine" },
      },
      relationTargets: {},
    });
    const secondRemoteRevisionId = generateUuidV7();
    const secondTransport = new ConflictTransport(secondRemoteRevisionId);
    secondTransport.revisions.set(currentItem.currentRevisionId, {
      databaseEntryValues: secondAncestor,
      databaseRelationTargets: {},
    });
    secondTransport.revisions.set(secondRemoteRevisionId, {
      databaseEntryValues: {
        ...secondAncestor,
        values: {
          ...secondAncestor.values,
          [seeded.textPropertyId]: { kind: "text", value: "theirs" },
        },
      },
      databaseRelationTargets: {},
    });

    const conflictOutcome = await reconcile(db, secondTransport, codec);
    const structuredConflict = (await new Outbox(db, codec).conflicts()).find(
      ({ structured }) => structured?.kind === "database-entry-values",
    );
    expect(conflictOutcome.conflicts).toBe(1);
    expect(structuredConflict?.structured).toMatchObject({
      kind: "database-entry-values",
      conflicts: [
        expect.objectContaining({
          path: `values.${seeded.textPropertyId}`,
          reason: "divergent-edit",
        }),
      ],
    });
  });
});
