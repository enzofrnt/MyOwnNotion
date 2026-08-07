/**
 * Server transaction fault injection for every mutation class (T070, US4,
 * SC-003): an injected failure after command execution but before commit
 * must leave the complete prior state; a rejected validation must write
 * nothing; replay must never duplicate side effects.
 */

import {
  executeCommand,
  type MutationContext,
  runMutation,
  schema,
  submitMutation,
} from "@myownnotion/database";
import { generateUuidV7, type MutationCommand, type Uuid } from "@myownnotion/domain";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
let counter = 0;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 120_000);

afterAll(async () => {
  await context.close();
});

async function createItem(kind: "page" | "folder", name: string, parent: Uuid | null = null) {
  counter += 1;
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind,
      name,
      placement: {
        kind: "hierarchy",
        parentItemId: parent,
        positionKey: `A${counter.toString(36)}x`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

interface TableCounts {
  [table: string]: number;
}

async function tableCounts(): Promise<TableCounts> {
  const client = new pg.Client({ connectionString: context.postgres.connectionString });
  await client.connect();
  try {
    const tables = [
      "items",
      "placements",
      "page_documents",
      "revisions",
      "revision_parents",
      "mutations",
      "changes",
      "relationships",
      "lifecycle_events",
      "logical_files",
      "file_contents",
    ];
    const counts: TableCounts = {};
    for (const table of tables) {
      const result = await client.query(`SELECT count(*)::int AS count FROM ${table}`);
      counts[table] = result.rows[0].count as number;
    }
    return counts;
  } finally {
    await client.end();
  }
}

class InjectedFault extends Error {
  constructor() {
    super("injected fault");
    this.name = "InjectedFault";
  }
}

/** Runs a command to completion inside a transaction, then aborts. */
async function executeThenFault(command: MutationCommand): Promise<void> {
  const mutationContext: MutationContext = {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    acceptedAt: new Date(),
  };
  await expect(
    runMutation(context.handle.db, async (tx) => {
      const execution = await executeCommand(tx, mutationContext, command);
      if (!execution.ok) {
        throw new Error(`command should have executed: ${execution.error.code}`);
      }
      // Fault injection at the last possible boundary before commit.
      throw new InjectedFault();
    }),
  ).rejects.toThrow("injected fault");
}

describe("fault injection at every mutation class (SC-003)", () => {
  it("item.create rollback leaves zero partial rows", async () => {
    const before = await tableCounts();
    await executeThenFault({
      type: "item.create",
      id: generateUuidV7(),
      kind: "page",
      name: "Never committed",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "Zzz1" },
    });
    expect(await tableCounts()).toEqual(before);
  });

  it("item.rename rollback preserves the prior name and lineage", async () => {
    const itemId = await createItem("page", "Original name");
    const before = await tableCounts();
    await executeThenFault({ type: "item.rename", itemId, name: "Interrupted rename" });
    expect(await tableCounts()).toEqual(before);
    const rows = await context.handle.db.select().from(schema.items);
    expect(rows.find((row) => row.id === itemId)?.name).toBe("Original name");
  });

  it("item.trash rollback leaves the complete branch active", async () => {
    const root = await createItem("folder", "Branch root");
    const child = await createItem("page", "Branch child", root);
    const before = await tableCounts();
    await executeThenFault({ type: "item.trash", itemId: root });
    expect(await tableCounts()).toEqual(before);
    const rows = await context.handle.db.select().from(schema.items);
    expect(rows.find((row) => row.id === root)?.lifecycle).toBe("active");
    expect(rows.find((row) => row.id === child)?.lifecycle).toBe("active");
  });

  it("item.restore rollback keeps the branch trashed", async () => {
    const root = await createItem("folder", "Restore root");
    await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.trash",
      command: { type: "item.trash", itemId: root },
    });
    const before = await tableCounts();
    await executeThenFault({ type: "item.restore", itemId: root });
    expect(await tableCounts()).toEqual(before);
    const rows = await context.handle.db.select().from(schema.items);
    expect(rows.find((row) => row.id === root)?.lifecycle).toBe("trashed");
  });

  it("placement.move rollback restores the prior parent (FR-018: no partial branch)", async () => {
    const a = await createItem("folder", "Move A");
    const b = await createItem("folder", "Move B");
    const placements = await context.handle.db.select().from(schema.placements);
    const placementId = placements.find((placement) => placement.itemId === a)?.id as Uuid;
    const before = await tableCounts();
    await executeThenFault({
      type: "placement.move",
      placementId,
      parentItemId: b,
      positionKey: "Mvx",
    });
    expect(await tableCounts()).toEqual(before);
    const after = await context.handle.db.select().from(schema.placements);
    expect(after.find((placement) => placement.id === placementId)?.parentItemId).toBeNull();
  });

  it("page.document.replace rollback preserves the prior document", async () => {
    const page = await createItem("page", "Doc page");
    const item = await context.handle.db.select().from(schema.items);
    const head = item.find((row) => row.id === page)?.currentRevisionId as Uuid;
    const before = await tableCounts();
    await executeThenFault({
      type: "page.document.replace",
      itemId: page,
      baseRevisionId: head,
      document: { format: "myownnotion.document+json", formatVersion: 1, body: { lost: true } },
    });
    expect(await tableCounts()).toEqual(before);
  });

  it("relationship.create rollback writes neither edge nor revision", async () => {
    const source = await createItem("page", "Rel source");
    const target = await createItem("page", "Rel target");
    const before = await tableCounts();
    await executeThenFault({
      type: "relationship.create",
      id: generateUuidV7(),
      sourceItemId: source,
      targetItemId: target,
      relationType: "link:references",
    });
    expect(await tableCounts()).toEqual(before);
  });

  it("validation rejection writes only the terminal mutation record", async () => {
    const before = await tableCounts();
    const outcome = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId: generateUuidV7(),
      commandType: "item.rename",
      command: { type: "item.rename", itemId: generateUuidV7(), name: "Ghost" },
    });
    expect(outcome.result.status).toBe("rejected");
    const after = await tableCounts();
    expect(after["mutations"]).toBe((before["mutations"] ?? 0) + 1);
    expect({ ...after, mutations: 0 }).toEqual({ ...before, mutations: 0 });
  });
});

describe("idempotent replay never duplicates side effects (FR-040)", () => {
  it("replaying an accepted mutation adds no rows", async () => {
    const mutationId = generateUuidV7();
    const command: MutationCommand = {
      type: "item.create",
      id: generateUuidV7(),
      kind: "folder",
      name: "Replay target",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "Rpx" },
    };
    const first = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId,
      commandType: "item.create",
      command,
    });
    expect(first.result.status).toBe("accepted");
    const before = await tableCounts();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const replay = await submitMutation(context.handle.db, {
        workspaceId: context.workspaceId,
        mutationId,
        commandType: "item.create",
        command,
      });
      expect(replay.result.status).toBe("already-accepted");
      expect(replay.result.revisionIds).toEqual(first.result.revisionIds);
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("replaying a rejected mutation stays rejected without new writes", async () => {
    const mutationId = generateUuidV7();
    const command: MutationCommand = {
      type: "item.rename",
      itemId: generateUuidV7(),
      name: "Ghost again",
    };
    const first = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId,
      commandType: "item.rename",
      command,
    });
    expect(first.result.status).toBe("rejected");
    const before = await tableCounts();
    const replay = await submitMutation(context.handle.db, {
      workspaceId: context.workspaceId,
      mutationId,
      commandType: "item.rename",
      command,
    });
    expect(replay.result.status).toBe("rejected");
    expect(await tableCounts()).toEqual(before);
  });
});
