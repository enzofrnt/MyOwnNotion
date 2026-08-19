import {
  applyLocalMutation,
  type LocalDatabase,
  LocalRepository,
  LocalSearchSource,
  openLocalDatabase,
} from "@myownnotion/client-core";
import type { ItemDto } from "@myownnotion/contracts";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestCodec, type TestCodec } from "./helpers/codec.ts";

let db: LocalDatabase;
let testCodec: TestCodec;
let repository: LocalRepository;

function item(input: {
  id: Uuid;
  name: string;
  kind?: "page" | "folder";
  parentItemId?: Uuid | null;
  body?: Record<string, unknown>;
}): ItemDto {
  const kind = input.kind ?? "page";
  return {
    id: input.id,
    kind,
    name: input.name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    placements: [
      {
        id: generateUuidV7(),
        itemId: input.id,
        kind: "hierarchy",
        parentItemId: input.parentItemId ?? null,
        positionKey: "V",
      },
    ],
    ...(kind === "page"
      ? {
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 2,
            body: input.body ?? { blocks: [] },
          },
        }
      : { pageDocument: null }),
  } as ItemDto;
}

beforeEach(async () => {
  testCodec = await createTestCodec();
  db = openLocalDatabase(`search-${generateUuidV7()}`);
  repository = new LocalRepository(db, testCodec.codec);
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
});
