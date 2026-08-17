/**
 * A reference survives a rename and a move (T017, US2, FR-003).
 *
 * The claim is easy to state and easy to break by accident: identity is the
 * item, not its name and not its path. Anything that resolved a file by either
 * would keep working right up until an owner tidied their workspace, and would
 * then break silently — the worst combination, because the tidying and the
 * breakage look unrelated.
 *
 * Asserted against real rows rather than against a plan that promises not to
 * touch them.
 */

import { createHash } from "node:crypto";
import { executeImportFile, runMutation, schema, submitMutation } from "@myownnotion/database";
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

async function createPage(positionKey: string, name = `page-${positionKey}`): Promise<Uuid> {
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name,
      placement: { kind: "hierarchy", parentItemId: null, positionKey },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function importFileInto(name: string, parent: Uuid | null): Promise<Uuid> {
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
      placement: {
        kind: parent === null ? "hierarchy" : "attachment",
        parentItemId: parent,
        positionKey: "V",
      },
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

async function usagesOf(fileItemId: Uuid) {
  return context.handle.db
    .select()
    .from(schema.fileUsages)
    .where(eq(schema.fileUsages.fileItemId, fileItemId));
}

describe("a reference outlives a rename", () => {
  it("keeps resolving after the file is renamed", async () => {
    const host = await createPage("Ra");
    const file = await importFileInto("original-name.txt", host);
    expect(await usagesOf(file)).toHaveLength(1);

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.rename",
      command: { type: "item.rename", itemId: file, name: "renamed.txt" },
    });
    expect(outcome.result.status).toBe("accepted");

    // Same usage row, untouched: the rename changed a name, not a reference.
    const after = await usagesOf(file);
    expect(after).toHaveLength(1);
    expect(after[0]?.usedByItemId).toBe(host);
  });

  it("keeps resolving after the file moves to another parent", async () => {
    const from = await createPage("Rb");
    const to = await createPage("Rc");
    const file = await importFileInto("moving.txt", from);

    const [placement] = await context.handle.db
      .select()
      .from(schema.placements)
      .where(and(eq(schema.placements.itemId, file), eq(schema.placements.kind, "attachment")));
    expect(placement).toBeDefined();

    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "placement.move",
      command: {
        type: "placement.move",
        placementId: placement?.id as Uuid,
        parentItemId: to,
        positionKey: "W",
      },
    });
    expect(outcome.result.status).toBe("accepted");

    // The file is still resolvable, and the content it points at is untouched:
    // moving a file is not a copy and not a rewrite.
    const [logical] = await context.handle.db
      .select()
      .from(schema.logicalFiles)
      .where(eq(schema.logicalFiles.itemId, file));
    expect(logical).toBeDefined();
    expect(logical?.originalName).toBe("moving.txt");
  });

  it("stores identical bytes once, however many files point at them", async () => {
    const host = await createPage("Rd");
    // Two imports of the same content: deduplication is feature 001's, and this
    // asserts feature 005 did not undermine it by recording usages.
    const first = await importFileInto("same-bytes.txt", host);
    const second = await importFileInto("same-bytes.txt", host);

    const [a] = await context.handle.db
      .select({ contentId: schema.logicalFiles.contentId })
      .from(schema.logicalFiles)
      .where(eq(schema.logicalFiles.itemId, first));
    const [b] = await context.handle.db
      .select({ contentId: schema.logicalFiles.contentId })
      .from(schema.logicalFiles)
      .where(eq(schema.logicalFiles.itemId, second));
    expect(a?.contentId).toBe(b?.contentId);

    // Two logical files, two independent usages: sharing bytes does not make
    // them the same file, and deleting one must not implicate the other.
    expect(await usagesOf(first)).toHaveLength(1);
    expect(await usagesOf(second)).toHaveLength(1);
  });
});
