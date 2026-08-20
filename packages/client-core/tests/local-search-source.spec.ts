import {
  applyLocalMutation,
  type LocalDatabase,
  LocalDatabaseRepository,
  LocalRepository,
  LocalSearchSource,
  openLocalDatabase,
} from "@myownnotion/client-core";
import type { ItemDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec, type TestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let testCodec: TestCodec;
let repository: LocalRepository;
let databases: LocalDatabaseRepository;

function item(input: {
  id: Uuid;
  name: string;
  kind?: "page" | "folder" | "file";
  parentItemId?: Uuid | null;
  body?: Record<string, unknown>;
  placements?: readonly {
    kind: "hierarchy" | "attachment";
    parentItemId: Uuid | null;
    positionKey?: string;
  }[];
}): ItemDto {
  const kind = input.kind ?? "page";
  return {
    id: input.id,
    kind,
    name: input.name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    placements: (
      input.placements ?? [{ kind: "hierarchy" as const, parentItemId: input.parentItemId ?? null }]
    ).map((placement) => ({
      id: generateUuidV7(),
      itemId: input.id,
      kind: placement.kind,
      parentItemId: placement.parentItemId,
      positionKey: placement.positionKey ?? "V",
    })),
    ...(kind === "page"
      ? {
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 2,
            body: input.body ?? { blocks: [] },
          },
        }
      : kind === "file"
        ? {
            pageDocument: null,
            file: {
              mediaType: "application/octet-stream",
              originalName: input.name,
              byteLength: 1,
            },
          }
        : { pageDocument: null }),
  } as ItemDto;
}

beforeEach(async () => {
  testCodec = await createTestCodec();
  db = openLocalDatabase(`search-${generateUuidV7()}`);
  repository = new LocalRepository(db, testCodec.codec);
  databases = new LocalDatabaseRepository(db, testCodec.codec);
});

afterEach(async () => {
  await db.delete();
});

describe("LocalSearchSource", () => {
  it("opens titles and only indexes page bodies actually present on this device", async () => {
    const folderId = generateUuidV7();
    const presentId = generateUuidV7();
    const offloadedId = generateUuidV7();
    const neverFetchedId = generateUuidV7();
    await repository.applyServerItems([
      item({ id: folderId, name: "Dossier", kind: "folder" }),
      item({
        id: presentId,
        name: "Présente",
        parentItemId: folderId,
        body: {
          blocks: [
            {
              type: "paragraph",
              id: generateUuidV7(),
              content: [{ text: "contenu local déchiffré" }],
            },
          ],
        },
      }),
      item({ id: offloadedId, name: "Déchargée" }),
      item({ id: neverFetchedId, name: "Jamais chargée" }),
    ]);
    await db.items.update(offloadedId, { localAvailability: "offloaded", sealedPageBody: null });
    await db.items.update(neverFetchedId, {
      localAvailability: "never-fetched",
      sealedPageBody: null,
    });

    const entries = await new LocalSearchSource(repository).list(0);
    const byId = new Map(entries.map((entry) => [entry.document.itemId, entry]));

    expect(byId.get(presentId)).toMatchObject({
      document: { title: "Présente", bodyText: "contenu local déchiffré" },
      localAvailability: "present",
      path: [
        { itemId: folderId, title: "Dossier" },
        { itemId: presentId, title: "Présente" },
      ],
    });
    expect(byId.get(offloadedId)).toMatchObject({
      document: { title: "Déchargée", bodyText: "" },
      localAvailability: "offloaded",
    });
    expect(byId.get(neverFetchedId)).toMatchObject({
      document: { title: "Jamais chargée", bodyText: "" },
      localAvailability: "never-fetched",
    });
  });

  it("exposes a locally committed rename as pending before server acknowledgement", async () => {
    const itemId = generateUuidV7();
    await repository.applyServerItems([item({ id: itemId, name: "Avant" })]);

    const mutation = await applyLocalMutation(
      db,
      {
        mutationId: generateUuidV7(),
        commandType: "item.rename",
        payload: { itemId, name: "Après" },
        baseRevisionIds: [],
      },
      () => new Date(),
      testCodec.codec,
    );
    expect(mutation.ok).toBe(true);

    const entries = await new LocalSearchSource(repository).read([itemId], 7);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      document: { title: "Après", sourceVersion: 7 },
      syncState: "pending",
    });
  });

  it("resolves the active root and descendants of the current local hierarchy", async () => {
    const rootId = generateUuidV7();
    const childId = generateUuidV7();
    const grandchildId = generateUuidV7();
    const siblingId = generateUuidV7();
    await repository.applyServerItems([
      item({ id: rootId, name: "Racine", kind: "folder" }),
      item({ id: childId, name: "Enfant", parentItemId: rootId }),
      item({ id: grandchildId, name: "Petit-enfant", parentItemId: childId }),
      item({ id: siblingId, name: "Autre branche", kind: "folder" }),
    ]);

    await expect(new LocalSearchSource(repository).activeDescendantIds(rootId)).resolves.toEqual([
      rootId,
      childId,
      grandchildId,
    ]);
  });

  it("uses every hierarchy placement but never attachment references for branch filtering", async () => {
    const firstRootId = generateUuidV7();
    const secondRootId = generateUuidV7();
    const multiplyPlacedFileId = generateUuidV7();
    const attachedOnlyFileId = generateUuidV7();
    await repository.applyServerItems([
      item({ id: firstRootId, name: "Première branche", kind: "folder" }),
      item({ id: secondRootId, name: "Seconde branche", kind: "folder" }),
      item({
        id: multiplyPlacedFileId,
        name: "partagé.pdf",
        kind: "file",
        placements: [
          { kind: "hierarchy", parentItemId: firstRootId, positionKey: "V" },
          { kind: "hierarchy", parentItemId: secondRootId, positionKey: "a" },
        ],
      }),
      item({
        id: attachedOnlyFileId,
        name: "pièce-jointe.pdf",
        kind: "file",
        placements: [{ kind: "attachment", parentItemId: firstRootId }],
      }),
    ]);

    const source = new LocalSearchSource(repository);
    await expect(source.activeDescendantIds(firstRootId)).resolves.toEqual([
      firstRootId,
      multiplyPlacedFileId,
    ]);
    await expect(source.activeDescendantIds(secondRootId)).resolves.toEqual([
      secondRootId,
      multiplyPlacedFileId,
    ]);
  });

  it("hydrates locally available text and task properties without duplicating an entry", async () => {
    const databaseId = generateUuidV7();
    const entryId = generateUuidV7();
    const titlePropertyId = generateUuidV7();
    const notePropertyId = generateUuidV7();
    const statusPropertyId = generateUuidV7();
    const duePropertyId = generateUuidV7();
    const priorityPropertyId = generateUuidV7();
    const todoOptionId = generateUuidV7();
    const highOptionId = generateUuidV7();
    const definition: DatabaseDefinition = {
      format: "myownnotion.database-definition+json",
      formatVersion: 1,
      databaseId,
      properties: [
        {
          id: titlePropertyId,
          name: "Title",
          type: "title",
          positionKey: "a",
          state: "active",
          config: {},
        },
        {
          id: notePropertyId,
          name: "Note",
          type: "text",
          positionKey: "b",
          state: "active",
          config: {},
        },
        {
          id: statusPropertyId,
          name: "Status",
          type: "status",
          positionKey: "c",
          state: "active",
          config: {
            options: [
              {
                id: todoOptionId,
                label: "To do",
                positionKey: "a",
                tone: "neutral",
                state: "active",
              },
            ],
          },
        },
        {
          id: duePropertyId,
          name: "Due",
          type: "date",
          positionKey: "d",
          state: "active",
          config: { mode: "date" },
        },
        {
          id: priorityPropertyId,
          name: "Priority",
          type: "select",
          positionKey: "e",
          state: "active",
          config: {
            options: [
              {
                id: highOptionId,
                label: "High",
                positionKey: "a",
                tone: "red",
                state: "active",
              },
            ],
          },
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
        statusPropertyId,
        dueDatePropertyId: duePropertyId,
        priorityPropertyId,
      },
    };
    await repository.applyServerItems([
      item({ id: databaseId, name: "Tasks" }),
      item({ id: entryId, name: "Ship task search" }),
    ]);
    await databases.putDatabase({ itemId: databaseId, definitionVersion: 1, definition });
    await databases.putEntry({
      entryItemId: entryId,
      databaseId,
      valueVersion: 1,
      availability: "present",
      values: {
        format: "myownnotion.database-entry-values+json",
        formatVersion: 1,
        databaseId,
        entryId,
        values: {
          [notePropertyId]: { kind: "text", value: "Owner-only plan" },
          [statusPropertyId]: { kind: "status", optionId: todoOptionId },
          [duePropertyId]: { kind: "date", date: "2026-09-15" },
          [priorityPropertyId]: { kind: "select", optionId: highOptionId },
        },
        preserved: [],
      },
    });

    const source = new LocalSearchSource(repository, databases);
    const entries = await source.read([databaseId], 9);
    const taskDocuments = entries.filter(({ document }) => document.itemId === entryId);
    expect(taskDocuments).toHaveLength(1);
    expect(taskDocuments[0]?.document.properties).toMatchObject([
      { propertyId: notePropertyId, text: "Owner-only plan" },
      { propertyId: statusPropertyId, text: "To do", taskRole: "status" },
      { propertyId: duePropertyId, text: "2026-09-15", taskRole: "dueDate" },
      { propertyId: priorityPropertyId, text: "High", taskRole: "priority" },
    ]);

    await db.databaseEntries.update(entryId, { availability: "offloaded" });
    const offloaded = await source.read([entryId], 10);
    expect(offloaded[0]?.document.properties).toEqual([]);
  });
});
