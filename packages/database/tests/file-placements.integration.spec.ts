/**
 * 100-placement, final-placement trash, and restore integration tests
 * (T049, US2, SC-009/SC-010).
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  executeImportFile,
  registerContent,
  runMutation,
  schema,
  submitMutation,
  type StoredContent,
} from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
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
    storageKey: createHash("sha256").update(bytes).digest("hex"),
    verifiedAt: new Date(),
    reusedExisting: false,
  };
}

let pageCounter = 0;

async function createPage(name: string): Promise<Uuid> {
  const id = generateUuidV7();
  pageCounter += 1;
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "page",
      name,
      placement: {
        kind: "hierarchy",
        parentItemId: null,
        positionKey: `P${pageCounter.toString(36)}x`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function importFile(name: string, text: string, parent: Uuid | null): Promise<Uuid> {
  const itemId = generateUuidV7();
  const mutationId = generateUuidV7();
  await runMutation(context.handle.db, async (tx) => {
    const execution = await executeImportFile(tx, {
      mutationId,
      workspaceId: context.workspaceId,
      itemId,
      name,
      mediaType: "text/plain",
      content: storedContent(text),
      placement: { kind: "hierarchy", parentItemId: parent, positionKey: "V" },
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

describe("one canonical file, one hundred placements (SC-009)", () => {
  it("adds 100 placements resolving to one logical file and one content object", async () => {
    const fileId = await importFile("shared.txt", "canonical bytes", null);
    const pages: Uuid[] = [];
    for (let index = 0; index < 9; index += 1) {
      pages.push(await createPage(`Host ${index}`));
    }

    for (let index = 0; index < 99; index += 1) {
      const attachment = index % 2 === 0;
      const outcome = await submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId: generateUuidV7(),
        commandType: "file.placement.add",
        command: {
          type: "file.placement.add",
          itemId: fileId,
          kind: attachment ? "attachment" : "hierarchy",
          parentItemId: attachment ? (pages[index % pages.length] as Uuid) : null,
          positionKey: `K${index.toString(36)}x`,
        },
      });
      expect(outcome.result.status).toBe("accepted");
    }

    const placements = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, fileId));
    expect(placements.filter((placement) => placement.removedAt === null).length).toBe(100);

    // One logical file, one content row.
    const files = await context.handle.db
      .select()
      .from(schema.logicalFiles)
      .where(eq(schema.logicalFiles.itemId, fileId));
    expect(files.length).toBe(1);
    const contents = await context.handle.db
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, files[0]?.contentId as string));
    expect(contents.length).toBe(1);
  });

  it("removes 99 placements without touching the file, then trashes on the final one (SC-010)", async () => {
    const fileId = await importFile("lifecycle.txt", "lifecycle bytes", null);
    const placementIds: Uuid[] = [];
    for (let index = 0; index < 99; index += 1) {
      const outcome = await submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId: generateUuidV7(),
        commandType: "file.placement.add",
        command: {
          type: "file.placement.add",
          itemId: fileId,
          kind: "hierarchy",
          parentItemId: null,
          positionKey: `L${index.toString(36)}x`,
        },
      });
      expect(outcome.result.status).toBe("accepted");
    }
    const placements = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, fileId));
    expect(placements.length).toBe(100);
    for (const placement of placements) {
      placementIds.push(placement.id as Uuid);
    }

    // Remove 99 of 100: file must stay active every time.
    for (let index = 0; index < 99; index += 1) {
      const outcome = await submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId: generateUuidV7(),
        commandType: "placement.remove",
        command: { type: "placement.remove", placementId: placementIds[index] as Uuid },
      });
      expect(outcome.result.status).toBe("accepted");
      const item = await context.handle.db
        .select()
        .from(schema.items)
        .where(eq(schema.items.id, fileId));
      expect(item[0]?.lifecycle).toBe("active");
    }

    // Final placement removal trashes the file with restorable metadata.
    const finalOutcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "placement.remove",
      command: { type: "placement.remove", placementId: placementIds[99] as Uuid },
    });
    expect(finalOutcome.result.status).toBe("accepted");
    const item = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, fileId));
    expect(item[0]?.lifecycle).toBe("trashed");
    expect(item[0]?.purgeAfter).not.toBeNull();

    const events = await context.handle.db
      .select()
      .from(schema.lifecycleEvents)
      .where(eq(schema.lifecycleEvents.itemId, fileId));
    const trashEvent = events.find((event) => event.eventType === "trashed");
    expect(trashEvent).toBeDefined();
    expect((trashEvent?.placementSnapshot as unknown[]).length).toBeGreaterThan(0);
  });

  it("restores the file with its last removed placement (FR-033)", async () => {
    const page = await createPage("Restore host");
    const fileId = await importFile("restore.txt", "restore bytes", page);
    const placements = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, fileId));
    const only = placements[0]?.id as Uuid;

    const removal = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "placement.remove",
      command: { type: "placement.remove", placementId: only },
    });
    expect(removal.result.status).toBe("accepted");

    const restore = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.restore",
      command: { type: "item.restore", itemId: fileId },
    });
    expect(restore.result.status).toBe("accepted");

    const item = await context.handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.id, fileId));
    expect(item[0]?.lifecycle).toBe("active");
    const restored = await context.handle.db
      .select()
      .from(schema.placements)
      .where(eq(schema.placements.itemId, fileId));
    const active = restored.filter((placement) => placement.removedAt === null);
    expect(active.length).toBe(1);
    expect(active[0]?.parentItemId).toBe(page);
    expect(active[0]?.kind).toBe("hierarchy");
  });

  it("independent imports of identical bytes stay logically separate (FR-034)", async () => {
    const first = await importFile("dup-a.txt", "identical!", null);
    const second = await importFile("dup-b.txt", "identical!", null);
    expect(first).not.toBe(second);
    const files = await context.handle.db.select().from(schema.logicalFiles);
    const involved = files.filter((file) => file.itemId === first || file.itemId === second);
    expect(involved.length).toBe(2);
  });
});

describe("content registration (T057)", () => {
  it("registerContent reuses rows only for verified physical reuse", async () => {
    const content = storedContent("register-me");
    await runMutation(context.handle.db, async (tx) => {
      await registerContent(tx, content);
    });
    await runMutation(context.handle.db, async (tx) => {
      const reused = await registerContent(tx, { ...content, reusedExisting: true });
      expect(reused).toBe(content.contentId);
    });
    const rows = await context.handle.db
      .select()
      .from(schema.fileContents)
      .where(eq(schema.fileContents.id, content.contentId));
    expect(rows.length).toBe(1);
    expect(rows[0]?.referenceCount).toBe(2);
  });
});
