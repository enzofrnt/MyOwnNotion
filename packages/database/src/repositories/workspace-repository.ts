/**
 * Single-workspace bootstrap (FR-001).
 *
 * One installation owns exactly one canonical workspace. The first call
 * creates it; every later call returns the same row.
 */
import { asc } from "drizzle-orm";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import type { Database } from "../client.ts";
import { workspaces } from "../schema/index.ts";

export const CANONICAL_SCHEMA_VERSION = 1;

export async function getOrCreateWorkspace(db: Database): Promise<{
  readonly id: Uuid;
  readonly schemaVersion: number;
}> {
  const existing = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  const first = existing[0];
  if (first !== undefined) {
    return { id: first.id as Uuid, schemaVersion: first.schemaVersion };
  }
  const id = generateUuidV7();
  await db
    .insert(workspaces)
    .values({ id, schemaVersion: CANONICAL_SCHEMA_VERSION })
    .onConflictDoNothing();
  const rows = await db.select().from(workspaces).orderBy(asc(workspaces.createdAt)).limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error("workspace bootstrap failed");
  }
  return { id: row.id as Uuid, schemaVersion: row.schemaVersion };
}
