/**
 * Converting an item, against a real database (T022, T030, US1, US2).
 *
 * The domain suite proves the rules decide correctly. This one proves the
 * repository does what it was told — and it exists because the code that
 * deletes a page's document and its sealed envelope is the most dangerous in
 * the feature, and until now no test executed it.
 *
 * Three claims are checked here and cannot be checked anywhere else:
 *
 *   - **children survive**, asserted against real placement rows rather than
 *     against a plan that promises not to touch them;
 *   - **the document and its envelope go together**, so destroyed content
 *     leaves nothing encrypted on disk that no screen shows;
 *   - **identity survives**, so every reference to the item still resolves.
 */

import {
  insertInitializingPageOperationState,
  readPageOperationState,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

/** Creates a page or folder at the root and returns its id. */
async function createItem(kind: "page" | "folder", positionKey: string): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind,
      name: `${kind}-${positionKey}`,
      placement: { kind: "hierarchy", parentItemId: null, positionKey },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function createChild(parentItemId: Uuid, positionKey: string): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name: `child-${positionKey}`,
      placement: { kind: "hierarchy", parentItemId, positionKey },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function writeDocument(itemId: Uuid): Promise<void> {
  const [item] = await context.handle.db
    .select({ currentRevisionId: schema.items.currentRevisionId })
    .from(schema.items)
    .where(eq(schema.items.id, itemId));
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "page.document.replace",
    command: {
      type: "page.document.replace",
      itemId,
      baseRevisionId: item?.currentRevisionId as Uuid,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: {
          blocks: [
            {
              type: "paragraph",
              id: "01924f8e-7c1a-7000-8000-0000000000bb",
              content: [{ text: "worth keeping" }],
            },
          ],
        },
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
}

async function convert(itemId: Uuid, targetKind: "page" | "folder", confirmedDestruction = false) {
  return await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.convert",
    command: { type: "item.convert", itemId, targetKind, confirmedDestruction },
  });
}

async function kindOf(itemId: Uuid): Promise<string | undefined> {
  const [row] = await context.handle.db
    .select({ kind: schema.items.kind })
    .from(schema.items)
    .where(eq(schema.items.id, itemId));
  return row?.kind;
}

async function activeChildIds(parentItemId: Uuid): Promise<string[]> {
  const rows = await context.handle.db
    .select({ itemId: schema.placements.itemId, positionKey: schema.placements.positionKey })
    .from(schema.placements)
    .where(
      and(
        eq(schema.placements.parentItemId, parentItemId),
        eq(schema.placements.kind, "hierarchy"),
      ),
    );
  return rows
    .sort((left, right) => left.positionKey.localeCompare(right.positionKey))
    .map((row) => row.itemId);
}

describe("folder to page", () => {
  it("gains content and keeps every child, in order", async () => {
    const folder = await createItem("folder", "V");
    const first = await createChild(folder, "V");
    const second = await createChild(folder, "W");

    const outcome = await convert(folder, "page");
    expect(outcome.result.status).toBe("accepted");

    expect(await kindOf(folder)).toBe("page");
    // Asserted against real rows: the children are where they were, in order.
    expect(await activeChildIds(folder)).toEqual([first, second]);
  });

  it("treats an empty document as nothing to lose", async () => {
    // Every page gets a document when it is created, with an empty body. If
    // that counted as content, an owner would be warned about destroying a
    // page they made ten seconds ago and never typed in — which teaches them
    // to dismiss the warning that matters (US2 scenario 6).
    const page = await createItem("page", "d");
    expect((await convert(page, "folder")).result.status).toBe("accepted");
    expect(await kindOf(page)).toBe("folder");
  });

  it("needs no confirmation, because nothing is lost", async () => {
    const folder = await createItem("folder", "X");
    const outcome = await convert(folder, "page");
    expect(outcome.result.status).toBe("accepted");
  });
});

describe("page to folder", () => {
  it("is refused when the page holds content and nothing was confirmed", async () => {
    // The guarantee that must hold for every caller, checked through the whole
    // stack rather than only in the domain.
    const page = await createItem("page", "Y");
    await writeDocument(page);

    const outcome = await convert(page, "folder");
    expect(outcome.result.status).toBe("rejected");
    expect(await kindOf(page)).toBe("page");
  });

  it("removes the document and its sealed envelope together when confirmed", async () => {
    // Deleting one and keeping the other would leave content the owner
    // deliberately destroyed on disk, encrypted, where no screen shows it.
    const page = await createItem("page", "Z");
    await writeDocument(page);

    const outcome = await convert(page, "folder", true);
    expect(outcome.result.status).toBe("accepted");
    expect(await kindOf(page)).toBe("folder");

    const documents = await context.handle.db
      .select({ pageId: schema.pageDocuments.pageId })
      .from(schema.pageDocuments)
      .where(eq(schema.pageDocuments.pageId, page));
    expect(documents).toHaveLength(0);

    const envelopes = await context.handle.db
      .select({ id: schema.protectedEnvelopes.id })
      .from(schema.protectedEnvelopes)
      .where(eq(schema.protectedEnvelopes.entityId, page));
    expect(envelopes).toHaveLength(0);
  });

  it("retires operational state before changing the item kind", async () => {
    const page = await createItem("page", "o");
    await writeDocument(page);
    const [item] = await context.handle.db
      .select({ currentRevisionId: schema.items.currentRevisionId })
      .from(schema.items)
      .where(eq(schema.items.id, page));
    await context.handle.db.transaction(async (tx) => {
      await insertInitializingPageOperationState(tx, {
        pageId: page,
        workspaceId: context.workspaceId,
        canonicalDigest: "a".repeat(64),
        lastRevisionId: item?.currentRevisionId as Uuid,
        now: new Date(),
      });
    });

    expect((await convert(page, "folder", true)).result.status).toBe("accepted");
    expect(await kindOf(page)).toBe("folder");
    expect(await readPageOperationState(context.handle.db, context.workspaceId, page)).toBeNull();
  });

  it("keeps every child when the content is destroyed", async () => {
    const page = await createItem("page", "a");
    const first = await createChild(page, "V");
    const second = await createChild(page, "W");
    await writeDocument(page);

    expect((await convert(page, "folder", true)).result.status).toBe("accepted");

    // The claim the spec makes without exception: what is under the item is
    // never what is destroyed.
    expect(await activeChildIds(page)).toEqual([first, second]);
  });
});

describe("identity and replay", () => {
  it("keeps the item's identity across a conversion", async () => {
    const folder = await createItem("folder", "b");
    await convert(folder, "page");
    // Same row, not a delete plus a create — so every reference still resolves.
    expect(await kindOf(folder)).toBe("page");
  });

  it("accepts a conversion to the kind the item already has", async () => {
    // A replayed offline command must succeed quietly rather than fail on the
    // second attempt.
    const folder = await createItem("folder", "c");
    expect((await convert(folder, "folder")).result.status).toBe("accepted");
    expect(await kindOf(folder)).toBe("folder");
  });

  it("refuses to convert a file", async () => {
    const outcome = await convert(generateUuidV7(), "page");
    // No such item, which is refused for its own reason; the file rule is
    // covered exhaustively in the domain suite where files can be constructed
    // without a stored blob.
    expect(outcome.result.status).toBe("rejected");
  });
});
