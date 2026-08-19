import {
  activeDescendantIds,
  hydrateSearchPaths,
  listSearchSources,
  readSearchSources,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, initialKeys, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
const ids = {
  root: generateUuidV7(),
  nested: generateUuidV7(),
  child: generateUuidV7(),
  outside: generateUuidV7(),
  trashed: generateUuidV7(),
};
const placementIds = {
  root: generateUuidV7(),
  nested: generateUuidV7(),
  child: generateUuidV7(),
  outside: generateUuidV7(),
  trashed: generateUuidV7(),
};

beforeAll(async () => {
  context = await createIntegrationContext();
  const mutationId = generateUuidV7();
  const keys = initialKeys(5);
  const revisionIds = Object.fromEntries(
    Object.keys(ids).map((key) => [key, generateUuidV7()]),
  ) as Record<keyof typeof ids, Uuid>;

  await context.handle.db.transaction(async (tx) => {
    await tx.insert(schema.mutations).values({
      id: mutationId,
      workspaceId: context.workspaceId,
      commandType: "fixture.search",
      status: "accepted",
      submittedAt: new Date(),
      acceptedAt: new Date(),
      resultRevisionIds: Object.values(revisionIds),
    });
    await tx.insert(schema.items).values([
      {
        id: ids.root,
        workspaceId: context.workspaceId,
        kind: "folder",
        name: "Racine",
        lifecycle: "active",
        currentRevisionId: revisionIds.root,
      },
      {
        id: ids.nested,
        workspaceId: context.workspaceId,
        kind: "folder",
        name: "Dossier",
        lifecycle: "active",
        currentRevisionId: revisionIds.nested,
      },
      {
        id: ids.child,
        workspaceId: context.workspaceId,
        kind: "page",
        name: "Page recherchable",
        lifecycle: "active",
        currentRevisionId: revisionIds.child,
      },
      {
        id: ids.outside,
        workspaceId: context.workspaceId,
        kind: "folder",
        name: "Ailleurs",
        lifecycle: "active",
        currentRevisionId: revisionIds.outside,
      },
      {
        id: ids.trashed,
        workspaceId: context.workspaceId,
        kind: "page",
        name: "Corbeille",
        lifecycle: "trashed",
        trashedAt: new Date(),
        purgeAfter: new Date(Date.now() + 86_400_000),
        currentRevisionId: revisionIds.trashed,
      },
    ]);
    await tx.insert(schema.revisions).values(
      Object.entries(ids).map(([key, itemId]) => ({
        id: revisionIds[key as keyof typeof ids],
        itemId,
        mutationId,
        snapshot: {},
        lineageDigest: "search-fixture",
      })),
    );
    await tx.insert(schema.placements).values([
      {
        id: placementIds.root,
        workspaceId: context.workspaceId,
        itemId: ids.root,
        itemIsFile: false,
        kind: "hierarchy",
        parentItemId: null,
        positionKey: keys[0] as string,
        createdRevisionId: revisionIds.root,
      },
      {
        id: placementIds.nested,
        workspaceId: context.workspaceId,
        itemId: ids.nested,
        itemIsFile: false,
        kind: "hierarchy",
        parentItemId: ids.root,
        positionKey: keys[1] as string,
        createdRevisionId: revisionIds.nested,
      },
      {
        id: placementIds.child,
        workspaceId: context.workspaceId,
        itemId: ids.child,
        itemIsFile: false,
        kind: "hierarchy",
        parentItemId: ids.nested,
        positionKey: keys[2] as string,
        createdRevisionId: revisionIds.child,
      },
      {
        id: placementIds.outside,
        workspaceId: context.workspaceId,
        itemId: ids.outside,
        itemIsFile: false,
        kind: "hierarchy",
        parentItemId: null,
        positionKey: keys[3] as string,
        createdRevisionId: revisionIds.outside,
      },
      {
        id: placementIds.trashed,
        workspaceId: context.workspaceId,
        itemId: ids.trashed,
        itemIsFile: false,
        kind: "hierarchy",
        parentItemId: ids.root,
        positionKey: keys[4] as string,
        createdRevisionId: revisionIds.trashed,
      },
    ]);
    await tx.insert(schema.pageDocuments).values([
      {
        pageId: ids.child,
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks: [{ type: "paragraph", content: "visible" }] },
      },
      {
        pageId: ids.trashed,
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks: [] },
      },
    ]);
  });
});

afterAll(async () => {
  await context.close();
});

describe("search source repository", () => {
  it("lists only active canonical sources with page bodies and current revisions", async () => {
    const sources = await listSearchSources(context.handle.db, context.workspaceId);

    expect(sources.map(({ itemId }) => itemId)).toEqual([
      ids.root,
      ids.nested,
      ids.child,
      ids.outside,
    ]);
    expect(sources.find(({ itemId }) => itemId === ids.child)).toMatchObject({
      kind: "page",
      storedName: "Page recherchable",
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks: [{ type: "paragraph", content: "visible" }] },
      },
    });
    expect(sources.some(({ itemId }) => itemId === ids.trashed)).toBe(false);
  });

  it("returns only active descendants and includes the branch root", async () => {
    const descendants = await activeDescendantIds(context.handle.db, ids.root);
    expect(new Set(descendants)).toEqual(new Set([ids.root, ids.nested, ids.child]));
    expect(descendants).not.toContain(ids.trashed);
    expect(descendants).not.toContain(ids.outside);
  });

  it("hydrates root-to-item paths from the current hierarchy", async () => {
    const paths = await hydrateSearchPaths(context.handle.db, [ids.child, ids.outside]);
    expect(paths.get(ids.child)).toEqual([
      { itemId: ids.root, storedName: "Racine" },
      { itemId: ids.nested, storedName: "Dossier" },
      { itemId: ids.child, storedName: "Page recherchable" },
    ]);
    expect(paths.get(ids.outside)).toEqual([{ itemId: ids.outside, storedName: "Ailleurs" }]);
  });

  it("reads only the requested active sources for incremental index updates", async () => {
    const sources = await readSearchSources(context.handle.db, context.workspaceId, [
      ids.child,
      ids.trashed,
      ids.outside,
    ]);

    expect(sources.map(({ itemId }) => itemId)).toEqual([ids.child, ids.outside]);
  });

  it("never retains an old path after a branch move", async () => {
    await context.handle.db
      .update(schema.placements)
      .set({ parentItemId: ids.outside })
      .where(eq(schema.placements.id, placementIds.nested));

    const paths = await hydrateSearchPaths(context.handle.db, [ids.child]);
    expect(paths.get(ids.child)).toEqual([
      { itemId: ids.outside, storedName: "Ailleurs" },
      { itemId: ids.nested, storedName: "Dossier" },
      { itemId: ids.child, storedName: "Page recherchable" },
    ]);
    expect(paths.get(ids.child)?.some(({ itemId }) => itemId === ids.root)).toBe(false);
  });

  it("tracks rename, move, conversion, trash, restore and a purged tombstone", async () => {
    const firstParentId = generateUuidV7();
    const secondParentId = generateUuidV7();
    const pageId = generateUuidV7();
    const firstPlacementId = generateUuidV7();
    const secondPlacementId = generateUuidV7();
    const pagePlacementId = generateUuidV7();
    const keys = initialKeys(3);
    const mutate = async (command: Parameters<typeof submitMutation>[1]["command"]) => {
      const outcome = await submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId: generateUuidV7(),
        commandType: command.type,
        command,
      });
      expect(outcome.result.status).toBe("accepted");
      return outcome;
    };

    await mutate({
      type: "item.create",
      id: firstParentId,
      kind: "folder",
      name: "Premier parent",
      placement: {
        id: firstPlacementId,
        kind: "hierarchy",
        parentItemId: null,
        positionKey: keys[0] as string,
      },
    });
    await mutate({
      type: "item.create",
      id: secondParentId,
      kind: "folder",
      name: "Second parent",
      placement: {
        id: secondPlacementId,
        kind: "hierarchy",
        parentItemId: null,
        positionKey: keys[1] as string,
      },
    });
    await mutate({
      type: "item.create",
      id: pageId,
      kind: "page",
      name: "Ancien titre",
      placement: {
        id: pagePlacementId,
        kind: "hierarchy",
        parentItemId: firstParentId,
        positionKey: keys[2] as string,
      },
      pageDocument: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: {
          blocks: [
            {
              type: "paragraph",
              id: generateUuidV7(),
              content: [{ text: "Corps à retirer lors de la conversion" }],
            },
          ],
        },
      },
    });

    await mutate({ type: "item.rename", itemId: pageId, name: "Titre courant" });
    expect(
      (await readSearchSources(context.handle.db, context.workspaceId, [pageId]))[0],
    ).toMatchObject({ itemId: pageId, storedName: "Titre courant", kind: "page" });

    await mutate({
      type: "placement.move",
      placementId: pagePlacementId,
      parentItemId: secondParentId,
      positionKey: keys[0] as string,
    });
    expect(await hydrateSearchPaths(context.handle.db, [pageId])).toEqual(
      new Map([
        [
          pageId,
          [
            { itemId: secondParentId, storedName: "Second parent" },
            { itemId: pageId, storedName: "Titre courant" },
          ],
        ],
      ]),
    );

    await mutate({
      type: "item.convert",
      itemId: pageId,
      targetKind: "folder",
      confirmedDestruction: true,
    });
    expect(
      (await readSearchSources(context.handle.db, context.workspaceId, [pageId]))[0],
    ).toMatchObject({ itemId: pageId, kind: "folder", pageDocument: null });

    await mutate({ type: "item.trash", itemId: pageId });
    expect(await readSearchSources(context.handle.db, context.workspaceId, [pageId])).toEqual([]);

    await mutate({ type: "item.restore", itemId: pageId });
    expect(
      (await readSearchSources(context.handle.db, context.workspaceId, [pageId]))[0],
    ).toMatchObject({ itemId: pageId, kind: "folder", storedName: "Titre courant" });

    // Feature 001 deliberately leaves execution of the retention policy to a
    // later owner-aware worker. Search still has to honour the resulting
    // canonical tombstone, whichever policy produced it.
    await context.handle.db
      .update(schema.items)
      .set({ lifecycle: "purged", trashedAt: null, purgeAfter: null })
      .where(eq(schema.items.id, pageId));
    expect(await readSearchSources(context.handle.db, context.workspaceId, [pageId])).toEqual([]);
    expect(
      await context.handle.db
        .select({ id: schema.revisions.id })
        .from(schema.revisions)
        .where(eq(schema.revisions.itemId, pageId)),
    ).not.toHaveLength(0);
  });
});
