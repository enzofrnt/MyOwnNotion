import { createHash } from "node:crypto";
import {
  executeImportFile,
  getFileContentDescriptor,
  listContentAuditInventory,
  listVerifiedReferencedContent,
  runMutation,
  type StoredContent,
  schema,
  updateVerifiedContentStorageKey,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 120_000);

afterAll(async () => {
  await context.close();
});

function storedContent(text: string): StoredContent {
  const bytes = new TextEncoder().encode(text);
  return {
    contentId: generateUuidV7(),
    sha256: new Uint8Array(createHash("sha256").update(bytes).digest()),
    byteLength: bytes.byteLength,
    storageKey: `legacy/${generateUuidV7()}`,
    verifiedAt: new Date(),
    reusedExisting: false,
  };
}

async function importFile(
  name: string,
  content: StoredContent,
): Promise<{
  itemId: Uuid;
  revisionId: Uuid;
}> {
  const itemId = generateUuidV7();
  const mutationId = generateUuidV7();
  return runMutation(context.handle.db, async (tx) => {
    const execution = await executeImportFile(tx, {
      mutationId,
      workspaceId: context.workspaceId,
      itemId,
      name,
      mediaType: "text/plain",
      content,
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
    return { itemId, revisionId: execution.value.revisionId };
  });
}

describe("file content descriptors", () => {
  it("returns only current active verified content with a lowercase digest", async () => {
    const content = storedContent("descriptor bytes");
    const file = await importFile('report "final".txt', content);

    const result = await runMutation(context.handle.db, (tx) =>
      getFileContentDescriptor(tx, file.itemId, file.revisionId),
    );

    expect(result).toEqual({
      status: "available",
      value: {
        itemId: file.itemId,
        revisionId: file.revisionId,
        contentId: content.contentId,
        name: 'report "final".txt',
        mediaType: "text/plain",
        byteLength: content.byteLength,
        sha256: Buffer.from(content.sha256).toString("hex"),
        storageKey: content.storageKey,
        verifiedAt: content.verifiedAt,
      },
    });
  });

  it("distinguishes a stale revision from unavailable metadata", async () => {
    const content = storedContent("stale bytes");
    const file = await importFile("stale.txt", content);
    const stale = generateUuidV7();

    await expect(
      runMutation(context.handle.db, (tx) => getFileContentDescriptor(tx, file.itemId, stale)),
    ).resolves.toEqual({
      status: "stale-revision",
      currentRevisionId: file.revisionId,
    });

    await context.handle.db
      .update(schema.logicalFiles)
      .set({ byteLength: content.byteLength + 1 })
      .where(eq(schema.logicalFiles.itemId, file.itemId));
    await expect(
      runMutation(context.handle.db, (tx) =>
        getFileContentDescriptor(tx, file.itemId, file.revisionId),
      ),
    ).resolves.toEqual({ status: "unavailable", reason: "metadata-mismatch" });
  });
});

describe("verified content inventories and legacy locator migration", () => {
  it("returns deterministic audit and verified referenced inventories", async () => {
    const verified = storedContent("inventory verified");
    const unverified = storedContent("inventory unverified");
    await importFile("verified.txt", verified);
    await context.handle.db.insert(schema.fileContents).values({
      id: unverified.contentId,
      sha256: unverified.sha256,
      byteLength: unverified.byteLength,
      storageKey: unverified.storageKey,
      verifiedAt: null,
      referenceCount: 0,
    });

    const audit = await runMutation(context.handle.db, listContentAuditInventory);
    const verifiedRow = audit.find((row) => row.contentId === verified.contentId);
    const unverifiedRow = audit.find((row) => row.contentId === unverified.contentId);
    expect(verifiedRow).toMatchObject({
      storageKey: verified.storageKey,
      verified: true,
      logicalReferenceCount: 1,
      byteLength: verified.byteLength,
    });
    expect(unverifiedRow).toMatchObject({ verified: false, logicalReferenceCount: 0 });
    expect(audit.map((row) => row.contentId)).toEqual(
      [...audit.map((row) => row.contentId)].sort(),
    );

    const recoverable = await runMutation(context.handle.db, listVerifiedReferencedContent);
    expect(recoverable.some((row) => row.contentId === verified.contentId)).toBe(true);
    expect(recoverable.some((row) => row.contentId === unverified.contentId)).toBe(false);
  });

  it("updates a legacy locator only after exact metadata was independently verified", async () => {
    const content = storedContent("migrate me");
    await importFile("migration.txt", content);
    const digest = Buffer.from(content.sha256).toString("hex");
    const nextKey = createHash("sha256").update("migrate me").digest("hex");

    const wrong = await runMutation(context.handle.db, (tx) =>
      updateVerifiedContentStorageKey(tx, {
        contentId: content.contentId,
        expectedStorageKey: content.storageKey,
        replacementStorageKey: nextKey,
        verifiedSha256: "0".repeat(64),
        verifiedByteLength: content.byteLength,
        verifiedAt: new Date(),
      }),
    );
    expect(wrong).toBe(false);

    const updated = await runMutation(context.handle.db, (tx) =>
      updateVerifiedContentStorageKey(tx, {
        contentId: content.contentId,
        expectedStorageKey: content.storageKey,
        replacementStorageKey: nextKey,
        verifiedSha256: digest,
        verifiedByteLength: content.byteLength,
        verifiedAt: new Date(),
      }),
    );
    expect(updated).toBe(true);

    const rows = await context.handle.db
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, content.contentId));
    expect(rows[0]?.storageKey).toBe(nextKey);
  });
});
