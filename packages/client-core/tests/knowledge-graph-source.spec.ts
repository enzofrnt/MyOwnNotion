import type { LocalRecordCodec } from "@myownnotion/client-core";
import { type LocalDatabase, LocalRepository, openLocalDatabase } from "@myownnotion/client-core";
import type { ItemDto, RelationshipDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, generateUuidV7 } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let codec: LocalRecordCodec;
let repository: LocalRepository;

function item(id: string, name: string, parentItemId: string | null): ItemDto {
  return {
    id,
    kind: "page",
    name,
    icon: null,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    pageDocument: null,
    placements: [
      {
        id: generateUuidV7(),
        itemId: id,
        kind: "hierarchy",
        parentItemId,
        positionKey: "V",
      },
    ],
  } as ItemDto;
}

beforeEach(async () => {
  ({ codec } = await createTestCodec());
  db = openLocalDatabase(`graph-source-${generateUuidV7()}`);
  repository = new LocalRepository(db, codec);
});

afterEach(async () => await db.delete());

describe("local knowledge graph source", () => {
  it("reads one atomic topology and opens only explicitly hydrated titles", async () => {
    const workspaceId = generateUuidV7();
    const first = generateUuidV7();
    const second = generateUuidV7();
    const relationship: RelationshipDto = {
      id: generateUuidV7(),
      sourceItemId: first,
      targetItemId: second,
      relationType: "page:link",
      metadata: {},
      createdRevisionId: generateUuidV7(),
      removedRevisionId: null,
    };
    await repository.replaceFromSnapshot({
      workspaceId,
      schemaVersion: 1,
      cursor: "42",
      items: [item(first, "Titre privé", null), item(second, "Cible privée", first)],
      relationships: [relationship],
    });

    const topology = await repository.readKnowledgeGraphTopology();
    expect(topology.coverage).toEqual({ state: "complete", cursor: "42" });
    expect(topology.nodes.every(({ name }) => name === null)).toBe(true);
    expect(topology.edges.map(({ relationType }) => relationType).toSorted()).toEqual([
      "hierarchy:contains",
      "page:link",
    ]);

    const hydrated = await repository.hydrateKnowledgeGraphNodes([second]);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]).toMatchObject({
      id: second,
      name: "Cible privée",
      parentIds: [first],
    });
  });

  it("marks a projection without a verified cursor as partial", async () => {
    await repository.applyServerItems([item(generateUuidV7(), "Local", null)]);
    expect((await repository.readKnowledgeGraphTopology()).coverage).toEqual({
      state: "partial",
      reason: "initial-sync",
      cursor: null,
    });
  });

  it("hydrates the complete local task vocabulary and file metadata used by the demo workspace", async () => {
    const workspaceId = generateUuidV7();
    const databaseId = generateUuidV7();
    const ordinaryDatabaseId = generateUuidV7();
    const ordinaryEntryId = generateUuidV7();
    const optionalTaskDatabaseId = generateUuidV7();
    const optionalTaskId = generateUuidV7();
    const taskId = generateUuidV7();
    const incompleteTaskId = generateUuidV7();
    const plainPageId = generateUuidV7();
    const fileId = generateUuidV7();
    const titleId = generateUuidV7();
    const textId = generateUuidV7();
    const numberId = generateUuidV7();
    const dateId = generateUuidV7();
    const instantId = generateUuidV7();
    const statusId = generateUuidV7();
    const priorityId = generateUuidV7();
    const tagsId = generateUuidV7();
    const checkboxId = generateUuidV7();
    const retiredId = generateUuidV7();
    const mismatchedStatusId = generateUuidV7();
    const mismatchedMultiId = generateUuidV7();
    const todoId = generateUuidV7();
    const highId = generateUuidV7();
    const unknownOptionId = generateUuidV7();
    const definition: DatabaseDefinition = {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId,
      properties: [
        {
          id: titleId,
          name: "Titre",
          type: "title",
          positionKey: "a",
          state: "active",
          config: {},
        },
        {
          id: textId,
          name: "Note",
          type: "text",
          positionKey: "b",
          state: "active",
          config: {},
        },
        {
          id: numberId,
          name: "Charge",
          type: "number",
          positionKey: "c",
          state: "active",
          config: {},
        },
        {
          id: dateId,
          name: "Échéance",
          type: "date",
          positionKey: "d",
          state: "active",
          config: { mode: "date" },
        },
        {
          id: instantId,
          name: "Rappel",
          type: "date",
          positionKey: "e",
          state: "active",
          config: { mode: "instant" },
        },
        {
          id: statusId,
          name: "Statut",
          type: "status",
          positionKey: "f",
          state: "active",
          config: {
            options: [
              {
                id: todoId,
                label: "À faire",
                positionKey: "a",
                tone: "neutral",
                state: "active",
              },
            ],
          },
        },
        {
          id: priorityId,
          name: "Priorité",
          type: "select",
          positionKey: "g",
          state: "active",
          config: {
            options: [
              {
                id: highId,
                label: "Haute",
                positionKey: "a",
                tone: "red",
                state: "active",
              },
            ],
          },
        },
        {
          id: tagsId,
          name: "Tags",
          type: "multi-select",
          positionKey: "h",
          state: "active",
          config: {
            options: [
              {
                id: todoId,
                label: "À faire",
                positionKey: "a",
                tone: "neutral",
                state: "active",
              },
            ],
          },
        },
        {
          id: checkboxId,
          name: "Terminé",
          type: "checkbox",
          positionKey: "i",
          state: "active",
          config: {},
        },
        {
          id: retiredId,
          name: "Ancien",
          type: "text",
          positionKey: "j",
          state: "retired",
          config: {},
        },
        {
          id: mismatchedStatusId,
          name: "Statut décalé",
          type: "text",
          positionKey: "k",
          state: "active",
          config: {},
        },
        {
          id: mismatchedMultiId,
          name: "Tags décalés",
          type: "text",
          positionKey: "l",
          state: "active",
          config: {},
        },
      ],
      views: [
        {
          id: generateUuidV7(),
          name: "Table",
          type: "table",
          positionKey: "a",
          state: "active",
          properties: [],
          filter: { mode: "all", criteria: [] },
          sorts: [],
          group: null,
          options: { density: "comfortable", freezeTitle: true },
        },
      ],
      taskRoles: {
        statusPropertyId: statusId,
        dueDatePropertyId: dateId,
        priorityPropertyId: priorityId,
      },
    };
    const ordinaryDefinition: DatabaseDefinition = {
      ...definition,
      databaseId: ordinaryDatabaseId,
      taskRoles: null,
    };
    const optionalTaskDefinition: DatabaseDefinition = {
      ...definition,
      databaseId: optionalTaskDatabaseId,
      taskRoles: {
        statusPropertyId: statusId,
        dueDatePropertyId: null,
        priorityPropertyId: null,
      },
    };
    const attachment = {
      ...item(fileId, "architecture.pdf", taskId),
      kind: "file",
      pageDocument: null,
      file: {
        mediaType: "application/pdf",
        originalName: "architecture.pdf",
        byteLength: 42,
      },
      placements: [
        {
          id: generateUuidV7(),
          itemId: fileId,
          kind: "attachment",
          parentItemId: taskId,
          positionKey: "V",
        },
      ],
    } as ItemDto;
    const values = {
      format: "myownnotion.database-entry-values+json" as const,
      formatVersion: 1 as const,
      databaseId,
      entryId: taskId,
      values: {
        [titleId]: { kind: "text" as const, value: "Livrer le graphe" },
        [textId]: { kind: "text" as const, value: "Scénario de démonstration" },
        [numberId]: { kind: "number" as const, decimal: "8" },
        [dateId]: { kind: "date" as const, date: "2026-09-15" },
        [instantId]: {
          kind: "instant" as const,
          instant: "2026-09-15T08:00:00.000Z",
        },
        [statusId]: { kind: "status" as const, optionId: todoId },
        [priorityId]: { kind: "select" as const, optionId: highId },
        [tagsId]: {
          kind: "multi-select" as const,
          optionIds: [unknownOptionId, todoId],
        },
        [checkboxId]: { kind: "checkbox" as const, checked: true },
        [retiredId]: { kind: "text" as const, value: "Ne doit pas sortir" },
        [mismatchedStatusId]: { kind: "status" as const, optionId: todoId },
        [mismatchedMultiId]: { kind: "multi-select" as const, optionIds: [todoId] },
      },
      preserved: [],
    };

    await repository.replaceFromSnapshot({
      workspaceId,
      schemaVersion: 1,
      cursor: "demo-graph",
      items: [
        item(databaseId, "Pilotage", null),
        item(ordinaryDatabaseId, "Référentiel", null),
        item(ordinaryEntryId, "Entrée ordinaire", null),
        item(optionalTaskDatabaseId, "Actions légères", null),
        item(optionalTaskId, "Action sans date", null),
        item(taskId, "Livrer le graphe", null),
        item(incompleteTaskId, "Tâche incomplète", null),
        item(plainPageId, "Page ordinaire", null),
        attachment,
      ],
      databases: [
        { itemId: databaseId, definitionVersion: 1, definition: definition as never },
        {
          itemId: ordinaryDatabaseId,
          definitionVersion: 1,
          definition: ordinaryDefinition as never,
        },
        {
          itemId: optionalTaskDatabaseId,
          definitionVersion: 1,
          definition: optionalTaskDefinition as never,
        },
      ],
      databaseEntries: [
        { entryItemId: taskId, databaseId, valueVersion: 1, values },
        {
          entryItemId: incompleteTaskId,
          databaseId,
          valueVersion: 1,
          values: {
            ...values,
            entryId: incompleteTaskId,
            values: {
              [statusId]: { kind: "status", optionId: unknownOptionId },
            },
          },
        },
        {
          entryItemId: ordinaryEntryId,
          databaseId: ordinaryDatabaseId,
          valueVersion: 1,
          values: {
            ...values,
            databaseId: ordinaryDatabaseId,
            entryId: ordinaryEntryId,
            values: { [textId]: { kind: "text", value: "Valeur ordinaire" } },
          },
        },
        {
          entryItemId: optionalTaskId,
          databaseId: optionalTaskDatabaseId,
          valueVersion: 1,
          values: {
            ...values,
            databaseId: optionalTaskDatabaseId,
            entryId: optionalTaskId,
            values: {},
          },
        },
      ],
    });

    const topology = await repository.readKnowledgeGraphTopology();
    expect(topology.nodes.find(({ id }) => id === databaseId)?.kind).toBe("database");
    expect(topology.nodes.find(({ id }) => id === taskId)?.kind).toBe("task");
    expect(topology.nodes.find(({ id }) => id === ordinaryEntryId)?.kind).toBe("page");
    expect(topology.nodes.find(({ id }) => id === optionalTaskId)?.kind).toBe("task");
    expect(topology.edges).toContainEqual(
      expect.objectContaining({
        sourceId: taskId,
        targetId: fileId,
        origin: "attachment",
      }),
    );

    const hydrated = await repository.hydrateKnowledgeGraphNodes([
      taskId,
      incompleteTaskId,
      databaseId,
      ordinaryEntryId,
      optionalTaskId,
      plainPageId,
      fileId,
      generateUuidV7(),
      taskId,
    ]);
    const task = hydrated.find(({ id }) => id === taskId);
    expect(task).toMatchObject({
      kind: "task",
      structured: {
        "property:Titre": "Livrer le graphe",
        "property:Note": "Scénario de démonstration",
        "property:Charge": "8",
        "property:Échéance": "2026-09-15",
        "property:Rappel": "2026-09-15T08:00:00.000Z",
        "property:Statut": "À faire",
        "property:Priorité": "Haute",
        "property:Tags": "Option indisponible, À faire",
        "property:Terminé": true,
        "property:Statut décalé": "Option indisponible",
        "property:Tags décalés": "Options indisponibles",
        status: "À faire",
        dueDate: "2026-09-15",
        priority: "Haute",
      },
    });
    expect(task?.structured).not.toHaveProperty("property:Ancien");
    expect(hydrated.find(({ id }) => id === incompleteTaskId)?.structured).toMatchObject({
      "property:Statut": "Option indisponible",
      status: "Option indisponible",
      dueDate: null,
      priority: null,
    });
    expect(hydrated.find(({ id }) => id === databaseId)?.kind).toBe("database");
    expect(hydrated.find(({ id }) => id === ordinaryEntryId)).toMatchObject({
      kind: "page",
      structured: { "property:Note": "Valeur ordinaire" },
    });
    expect(hydrated.find(({ id }) => id === optionalTaskId)).toMatchObject({
      kind: "task",
      structured: { status: null },
    });
    expect(hydrated.find(({ id }) => id === optionalTaskId)?.structured).not.toHaveProperty(
      "dueDate",
    );
    expect(hydrated.find(({ id }) => id === plainPageId)).toMatchObject({
      kind: "page",
      structured: {},
    });
    expect(hydrated.find(({ id }) => id === fileId)).toMatchObject({
      kind: "file",
      mediaType: "application/pdf",
      parentIds: [],
    });

    await db.databaseEntries.update(taskId, { availability: "offloaded" });
    expect((await repository.hydrateKnowledgeGraphNodes([taskId]))[0]?.structured).toEqual({});
  });

  it("rebuilds 100 local add/remove cycles with one occurrence or none", async () => {
    const workspaceId = generateUuidV7();
    for (let run = 1; run <= 100; run += 1) {
      const sourceId = generateUuidV7();
      const targetId = generateUuidV7();
      const relationship: RelationshipDto = {
        id: generateUuidV7(),
        sourceItemId: sourceId,
        targetItemId: targetId,
        relationType: "page:link",
        metadata: {},
        createdRevisionId: generateUuidV7(),
        removedRevisionId: null,
      };
      await repository.replaceFromSnapshot({
        workspaceId,
        schemaVersion: 1,
        cursor: `added-${run}`,
        items: [item(sourceId, `Source ${run}`, null), item(targetId, `Target ${run}`, null)],
        relationships: [relationship, relationship],
      });
      const added = await repository.readKnowledgeGraphTopology();
      expect(added.edges.filter(({ relationType }) => relationType === "page:link")).toHaveLength(
        1,
      );

      await repository.replaceFromSnapshot({
        workspaceId,
        schemaVersion: 1,
        cursor: `removed-${run}`,
        items: [item(sourceId, `Source ${run}`, null), item(targetId, `Target ${run}`, null)],
        relationships: [],
      });
      const removed = await repository.readKnowledgeGraphTopology();
      expect(removed.edges.filter(({ relationType }) => relationType === "page:link")).toHaveLength(
        0,
      );
    }
  });
});
