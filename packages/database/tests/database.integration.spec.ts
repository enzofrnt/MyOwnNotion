import {
  executeCommand,
  type MutationContext,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  runMutation,
  schema,
  submitMutation,
} from "@myownnotion/database";
import {
  type DatabaseDefinition,
  generateUuidV7,
  type MutationCommand,
  type Uuid,
} from "@myownnotion/domain";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

function databaseCreate(
  id = generateUuidV7(),
): Extract<MutationCommand, { type: "database.create" }> {
  return {
    type: "database.create",
    id,
    name: "Projets privés",
    placement: { id: generateUuidV7(), parentItemId: null, positionKey: "V" },
    titlePropertyId: generateUuidV7(),
    initialViewId: generateUuidV7(),
    initialViewName: "Vue privée",
  };
}

async function submit(command: MutationCommand, mutationId = generateUuidV7()) {
  return await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId,
    commandType: command.type,
    command,
  });
}

async function createPage(name: string): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submit({
    type: "item.create",
    id,
    kind: "page",
    name,
    placement: { kind: "hierarchy", parentItemId: null, positionKey: "W" },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function parentRevisionIds(revisionId: Uuid): Promise<Uuid[]> {
  const rows = await context.handle.db
    .select({ parentRevisionId: schema.revisionParents.parentRevisionId })
    .from(schema.revisionParents)
    .where(eq(schema.revisionParents.revisionId, revisionId));
  return rows.map(({ parentRevisionId }) => parentRevisionId as Uuid);
}

function expandedDefinition(
  create: Extract<MutationCommand, { type: "database.create" }>,
  relationPropertyId: Uuid,
  textPropertyId: Uuid,
): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: create.id,
    properties: [
      {
        id: create.titlePropertyId,
        name: "Titre",
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
      {
        id: textPropertyId,
        name: "Secret",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: relationPropertyId,
        name: "Dépend de",
        type: "relation",
        positionKey: "c",
        state: "active",
        config: { cardinality: "many" },
      },
    ],
    views: [
      {
        id: create.initialViewId,
        name: create.initialViewName,
        type: "table",
        positionKey: "a",
        state: "active",
        properties: [
          { propertyId: create.titlePropertyId, visible: true, positionKey: "a" },
          { propertyId: textPropertyId, visible: true, positionKey: "b" },
          { propertyId: relationPropertyId, visible: true, positionKey: "c" },
        ],
        filter: { mode: "all", criteria: [] },
        sorts: [],
        group: null,
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
    taskRoles: null,
  };
}

describe("database capability and entries (T019)", () => {
  it("creates a page-backed database atomically and replays without duplicate identity", async () => {
    const command = databaseCreate();
    const mutationId = generateUuidV7();
    const first = await submit(command, mutationId);
    expect(first.result.status).toBe("accepted");
    expect(first.primaryItemId).toBe(command.id);

    const record = await readDatabaseRecord(context.handle.db, command.id);
    expect(record).toMatchObject({
      databaseId: command.id,
      workspaceId: context.workspaceId,
      definitionVersion: 1,
    });
    const [item] = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, command.id));
    expect(item?.kind).toBe("page");
    expect(item?.id).toBe(command.id);

    const replay = await submit(command, mutationId);
    expect(replay.result.status).toBe("already-accepted");
    const rows = await context.handle.db
      .select()
      .from(schema.databases)
      .where(eq(schema.databases.itemId, command.id));
    expect(rows).toHaveLength(1);
  });

  it("creates one canonical entry membership and stable property relations", async () => {
    const create = databaseCreate();
    const created = await submit(create);
    expect(created.result.status).toBe("accepted");
    const baseRevisionId = created.result.revisionIds?.[0] as Uuid;
    const relationPropertyId = generateUuidV7();
    const textPropertyId = generateUuidV7();
    const definition = expandedDefinition(create, relationPropertyId, textPropertyId);
    const replaced = await submit({
      type: "database.definition.replace",
      databaseId: create.id,
      baseRevisionId,
      definition,
    });
    expect(replaced.result.status).toBe("accepted");

    const target = await createPage("Cible renommable");
    const entryId = generateUuidV7();
    const privateValue = "sentinel-value-never-structural";
    const entry = await submit({
      type: "database.entry.create",
      databaseId: create.id,
      id: entryId,
      title: "Entrée privée",
      placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
      values: { [textPropertyId]: { kind: "text", value: privateValue } },
      relationTargets: { [relationPropertyId]: [target] },
    });
    expect(entry.result.status).toBe("accepted");

    expect(await readDatabaseEntryRecord(context.handle.db, entryId)).toMatchObject({
      entryId,
      databaseId: create.id,
      valueVersion: 1,
    });
    const activeRelationships = await context.handle.db
      .select()
      .from(schema.relationships)
      .where(
        and(
          eq(schema.relationships.sourceItemId, entryId),
          eq(schema.relationships.relationType, "database:property"),
          isNull(schema.relationships.removedRevisionId),
        ),
      );
    expect(activeRelationships).toHaveLength(1);
    expect(activeRelationships[0]).toMatchObject({
      targetItemId: target,
      metadata: { databaseId: create.id, propertyId: relationPropertyId },
    });

    // Definition/value payloads have no columns in the structural tables.
    const structuralDump = JSON.stringify({
      database: await readDatabaseRecord(context.handle.db, create.id),
      entry: await readDatabaseEntryRecord(context.handle.db, entryId),
    });
    expect(structuralDump).not.toContain(privateValue);
    expect(structuralDump).not.toContain("Secret");
  });

  it("rejects a second active membership for the same canonical page", async () => {
    const first = databaseCreate();
    const second = databaseCreate();
    await submit(first);
    await submit(second);
    const entryId = generateUuidV7();
    expect(
      (
        await submit({
          type: "database.entry.create",
          databaseId: first.id,
          id: entryId,
          title: "Unique",
          placement: { id: generateUuidV7(), parentItemId: null, positionKey: "a" },
          values: {},
          relationTargets: {},
        })
      ).result.status,
    ).toBe("accepted");
    const duplicate = await submit({
      type: "database.entry.create",
      databaseId: second.id,
      id: entryId,
      title: "Duplicated",
      placement: { id: generateUuidV7(), parentItemId: null, positionKey: "b" },
      values: {},
      relationTargets: {},
    });
    expect(duplicate.result.status).toBe("rejected");
    expect(duplicate.result.problem?.code).toBe("database.membership-conflict");
    expect(await readDatabaseEntryRecord(context.handle.db, entryId)).toMatchObject({
      databaseId: first.id,
    });
  });

  it("refuses conversion of a database host or entry while the capability exists", async () => {
    const create = databaseCreate();
    await submit(create);
    const entryId = generateUuidV7();
    await submit({
      type: "database.entry.create",
      databaseId: create.id,
      id: entryId,
      title: "Structured page",
      placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
      values: {},
      relationTargets: {},
    });
    for (const itemId of [create.id, entryId]) {
      const result = await submit({
        type: "item.convert",
        itemId,
        targetKind: "folder",
        confirmedDestruction: true,
      });
      expect(result.result.status).toBe("rejected");
      expect(result.result.problem?.code).toBe("database.page-required");
    }
  });

  it("carries structured state through ordinary page revisions", async () => {
    const create = databaseCreate();
    await submit(create);
    const entryId = generateUuidV7();
    await submit({
      type: "database.entry.create",
      databaseId: create.id,
      id: entryId,
      title: "Before rename",
      placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
      values: {},
      relationTargets: {},
    });
    await submit({ type: "item.rename", itemId: create.id, name: "Renamed database" });
    await submit({ type: "item.rename", itemId: entryId, name: "Renamed entry" });

    expect((await readCurrentDatabaseDefinition(context.handle.db, create.id))?.databaseId).toBe(
      create.id,
    );
    expect(await readCurrentDatabaseEntryValues(context.handle.db, entryId)).toMatchObject({
      databaseId: create.id,
      entryId,
      values: {},
    });
  });

  it("records structured conflict resolutions as revisions with two parents", async () => {
    const create = databaseCreate();
    const created = await submit(create);
    const createdRevisionId = created.result.revisionIds?.[0];
    if (createdRevisionId === undefined) throw new Error("database revision missing");
    const relationPropertyId = generateUuidV7();
    const textPropertyId = generateUuidV7();
    const initialDefinition = expandedDefinition(create, relationPropertyId, textPropertyId);
    const replaced = await submit({
      type: "database.definition.replace",
      databaseId: create.id,
      baseRevisionId: createdRevisionId,
      definition: initialDefinition,
    });
    const replacedRevisionId = replaced.result.revisionIds?.[0];
    if (replacedRevisionId === undefined) throw new Error("definition revision missing");

    const resolvedDefinition = {
      ...initialDefinition,
      views: initialDefinition.views.map((view) => ({ ...view, name: "Vue résolue" })),
    };
    const definitionResolution = await submit({
      type: "database.definition.resolve-conflict",
      databaseId: create.id,
      resolvedRevisionIds: [replacedRevisionId, createdRevisionId],
      definition: resolvedDefinition,
    });
    const definitionResolutionId = definitionResolution.result.revisionIds?.[0];
    if (definitionResolutionId === undefined) throw new Error("resolution revision missing");
    expect(await parentRevisionIds(definitionResolutionId)).toEqual(
      expect.arrayContaining([replacedRevisionId, createdRevisionId]),
    );

    const entryId = generateUuidV7();
    const entryCreated = await submit({
      type: "database.entry.create",
      databaseId: create.id,
      id: entryId,
      title: "Entrée à résoudre",
      placement: { id: generateUuidV7(), parentItemId: create.id, positionKey: "a" },
      values: { [textPropertyId]: { kind: "text", value: "ancestor" } },
      relationTargets: {},
    });
    const entryCreatedRevisionId = entryCreated.result.revisionIds?.[0];
    if (entryCreatedRevisionId === undefined) throw new Error("entry revision missing");
    const entryReplaced = await submit({
      type: "database.entry.values.replace",
      databaseId: create.id,
      entryId,
      baseRevisionId: entryCreatedRevisionId,
      values: { [textPropertyId]: { kind: "text", value: "local" } },
      relationTargets: {},
    });
    const entryReplacedRevisionId = entryReplaced.result.revisionIds?.[0];
    if (entryReplacedRevisionId === undefined) throw new Error("entry edit revision missing");
    const entryResolution = await submit({
      type: "database.entry.values.resolve-conflict",
      databaseId: create.id,
      entryId,
      resolvedRevisionIds: [entryReplacedRevisionId, entryCreatedRevisionId],
      values: { [textPropertyId]: { kind: "text", value: "resolved" } },
      relationTargets: {},
    });
    const entryResolutionId = entryResolution.result.revisionIds?.[0];
    if (entryResolutionId === undefined) throw new Error("entry resolution revision missing");
    expect(await parentRevisionIds(entryResolutionId)).toEqual(
      expect.arrayContaining([entryReplacedRevisionId, entryCreatedRevisionId]),
    );
    expect(await readCurrentDatabaseEntryValues(context.handle.db, entryId)).toMatchObject({
      values: { [textPropertyId]: { kind: "text", value: "resolved" } },
    });
  });

  it("rolls back item, capability, entry and relations on a final-boundary fault", async () => {
    const create = databaseCreate();
    const command: MutationCommand = create;
    const mutationContext: MutationContext = {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      acceptedAt: new Date(),
    };
    await expect(
      runMutation(context.handle.db, async (tx) => {
        const result = await executeCommand(tx, mutationContext, command);
        expect(result.ok).toBe(true);
        throw new Error("database-final-boundary-fault");
      }),
    ).rejects.toThrow("database-final-boundary-fault");
    expect(await readDatabaseRecord(context.handle.db, create.id)).toBeNull();
    const item = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, create.id));
    expect(item).toHaveLength(0);
  });
});
