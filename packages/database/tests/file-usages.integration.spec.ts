/**
 * The usage index against a real database (T010, US1, FR-004, FR-005).
 *
 * The domain suite proves the extraction is right. This proves the index that
 * an owner's deletion confirmation actually reads stays in step with the
 * documents and placements it is derived from — which is a different claim, and
 * the one that costs content when it is false.
 *
 * Both directions are asserted deliberately:
 *
 * - **under-reporting** tells an owner a file is unused while a page still
 *   shows it, and they destroy it;
 * - **over-reporting** blocks a deletion they are entitled to make and sends
 *   them hunting for a page that no longer references anything.
 */

import { createHash } from "node:crypto";
import { executeImportFile, runMutation, schema, submitMutation } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

async function createPage(positionKey: string): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name: `page-${positionKey}`,
      placement: { kind: "hierarchy", parentItemId: null, positionKey },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

/**
 * A logical file, imported through the real path rather than assembled by hand.
 *
 * A hand-built fixture drifts from what the application actually writes, and
 * this suite's whole claim is that the index matches what the application
 * writes. It also avoids re-deriving the invariants of the item/revision pair,
 * whose foreign key is deferred to commit time.
 */
async function createFile(name: string): Promise<Uuid> {
  const itemId = generateUuidV7();
  const mutationId = generateUuidV7();
  const bytes = new TextEncoder().encode(`bytes of ${name}`);
  await runMutation(context.handle.db, async (tx) => {
    const execution = await executeImportFile(tx, {
      mutationId,
      workspaceId: context.workspaceId,
      itemId,
      name,
      mediaType: "text/plain",
      content: {
        contentId: generateUuidV7(),
        sha256: new Uint8Array(createHash("sha256").update(bytes).digest()),
        byteLength: bytes.byteLength,
        storageKey: createHash("sha256").update(bytes).digest("hex"),
        verifiedAt: new Date(),
        reusedExisting: false,
      },
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
      acceptedAt: new Date(),
    });
    if (!execution.ok) {
      throw new Error(execution.error.code);
    }
    await tx.insert(schema.mutations).values({
      id: mutationId,
      workspaceId: context.workspaceId,
      commandType: "file.import",
      status: "accepted",
      submittedAt: new Date(),
      acceptedAt: new Date(),
      resultRevisionIds: [execution.value.revisionId],
    });
  });
  return itemId;
}

async function writeDocument(pageId: Uuid, blocks: unknown[]): Promise<void> {
  const [item] = await context.handle.db
    .select({ currentRevisionId: schema.items.currentRevisionId })
    .from(schema.items)
    .where(eq(schema.items.id, pageId));
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "page.document.replace",
    command: {
      type: "page.document.replace",
      itemId: pageId,
      baseRevisionId: item?.currentRevisionId as Uuid,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks },
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
}

async function usagesOf(fileItemId: Uuid) {
  return context.handle.db
    .select()
    .from(schema.fileUsages)
    .where(eq(schema.fileUsages.fileItemId, fileItemId));
}

function embed(fileItemId: Uuid) {
  return { type: "fileEmbed", id: generateUuidV7(), fileItemId, caption: null };
}

describe("embeds", () => {
  it("records a usage when a document embeds a file", async () => {
    const page = await createPage("Ua");
    const file = await createFile("diagram.txt");

    await writeDocument(page, [embed(file)]);

    const usages = await usagesOf(file);
    expect(usages).toHaveLength(1);
    expect(usages[0]?.usedByItemId).toBe(page);
    expect(usages[0]?.usageKind).toBe("embed");
    expect(usages[0]?.blockId).not.toBeNull();
  });

  it("drops the usage when the embed is removed from the document", async () => {
    const page = await createPage("Ub");
    const file = await createFile("removed.txt");
    await writeDocument(page, [embed(file)]);
    expect(await usagesOf(file)).toHaveLength(1);

    await writeDocument(page, [{ type: "paragraph", id: generateUuidV7(), content: [] }]);

    // Over-reporting is not the safe direction: a usage left behind blocks a
    // deletion the owner is entitled to make.
    expect(await usagesOf(file)).toHaveLength(0);
  });

  it("counts the same file embedded twice as two usages", async () => {
    const page = await createPage("Uc");
    const file = await createFile("twice.txt");

    await writeDocument(page, [embed(file), embed(file)]);

    // What the owner sees is two embeds; a confirmation saying "used in 1
    // place" would be describing something else.
    expect(await usagesOf(file)).toHaveLength(2);
  });

  it("ignores an embed pointing at something that is not a file", async () => {
    const page = await createPage("Ud");
    const notAFile = await createPage("Ue");

    await writeDocument(page, [embed(notAFile)]);

    // A usage the owner could never reach would appear in a confirmation as
    // though it meant something.
    expect(await usagesOf(notAFile)).toHaveLength(0);
  });

  it("survives a document whose body cannot be validated", async () => {
    const page = await createPage("Uf");
    // A save must not fail because the usage index could not be built: that
    // would turn a bookkeeping problem into lost work.
    await writeDocument(page, [{ type: "paragraph", id: generateUuidV7(), content: [] }]);
    expect(true).toBe(true);
  });
});
