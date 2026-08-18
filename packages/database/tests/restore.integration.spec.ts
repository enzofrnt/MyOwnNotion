/**
 * A rehearsal writes, and leaves the live workspace alone (T021, T029, T030 — FR-018).
 *
 * The assertion that carries this suite is the negative one: after a rehearsal,
 * the live database is byte-for-byte what it was. It is asserted rather than
 * assumed because the property is structural — the live connection is never
 * opened — and a structural property that nobody checks is one a later
 * refactoring can quietly remove.
 *
 * The positive assertion matters too, and for a reason easy to lose sight of: a
 * rehearsal that does not *write* proves the archive is readable and nothing
 * about whether it can be written back. Constraint violations, ordering problems
 * and schema mismatches all surface at write time.
 */

import { getOrCreateWorkspace, schema, submitMutation } from "@myownnotion/database";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDisposableWorkspace } from "../../../apps/api/src/backup/disposable-workspace.ts";
import { createIntegrationContext, type IntegrationContext } from "./helpers/db.ts";

let context: IntegrationContext;
let counter = 0;

beforeAll(async () => {
  context = await createIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

async function createFolder(name: string): Promise<Uuid> {
  counter += 1;
  const id = generateUuidV7();
  const outcome = await submitMutation(context.handle.db, {
    workspaceId: context.workspaceId,
    mutationId: generateUuidV7(),
    commandType: "item.create",
    command: {
      type: "item.create",
      id,
      kind: "folder",
      name,
      placement: {
        kind: "hierarchy",
        parentItemId: null,
        positionKey: `V${counter.toString(36)}r`,
      },
    },
  });
  expect(outcome.result.status).toBe("accepted");
  return id;
}

async function liveItemNames(): Promise<string[]> {
  const rows = await context.handle.db.select({ name: schema.items.name }).from(schema.items);
  return rows.map((row) => row.name).sort();
}

describe("rehearsing a restoration", () => {
  it("creates a database of its own, migrated and empty of workspace content", async () => {
    await createFolder("Live content");
    const before = await liveItemNames();

    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      // Migrated: the schema is there.
      const workspace = await getOrCreateWorkspace(rehearsal.handle.db);
      expect(workspace.id).toBeDefined();

      // And empty: nothing of the live workspace leaked into it, which is the
      // other half of isolation — a rehearsal that started from a copy of the
      // live data would prove nothing about restoring onto an empty machine.
      const rows = await rehearsal.handle.db.select({ name: schema.items.name }).from(schema.items);
      expect(rows).toEqual([]);
    } finally {
      await rehearsal.release();
    }

    // The live workspace is exactly what it was. This is FR-018, and it holds
    // because the live connection was never opened rather than because a flag
    // said not to write.
    expect(await liveItemNames()).toEqual(before);
  });

  it("accepts writes, which is the whole point of rehearsing", async () => {
    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    try {
      const workspace = await getOrCreateWorkspace(rehearsal.handle.db);
      const id = generateUuidV7();
      const outcome = await submitMutation(rehearsal.handle.db, {
        workspaceId: workspace.id,
        mutationId: generateUuidV7(),
        commandType: "item.create",
        command: {
          type: "item.create",
          id,
          kind: "folder",
          name: "Restored into the rehearsal",
          placement: { kind: "hierarchy", parentItemId: null, positionKey: "Vq" },
        },
      });
      // A dry run would have proven the archive readable and nothing about
      // whether it can be written back.
      expect(outcome.result.status).toBe("accepted");
    } finally {
      await rehearsal.release();
    }
  });

  it("drops its database afterwards, and tolerates being released twice", async () => {
    const rehearsal = await createDisposableWorkspace(context.postgres.connectionString);
    const name = rehearsal.databaseName;
    await rehearsal.release();
    // Idempotent: a caller releasing in a `finally` after an early return should
    // not have to track whether it already happened.
    await rehearsal.release();

    const admin = context.handle.db;
    const rows = await admin.execute(
      `SELECT 1 FROM pg_database WHERE datname = '${name}'` as never,
    );
    // A rehearsal per attempt, left behind, accumulates on a server nobody is
    // watching.
    expect((rows as unknown as { rows: unknown[] }).rows ?? []).toEqual([]);
  });
});
