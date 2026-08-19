/**
 * A database that exists for one rehearsal (T031, FR-018).
 *
 * This is what makes "without overwriting the live installation" structural
 * rather than promised: the live database is never opened during a rehearsal, so
 * a rehearsal cannot alter it. No flag guards it, no code path has to remember —
 * the connection simply points somewhere else.
 *
 * The alternative that looks safer is a dry run: read the archive, check the
 * manifest, verify the digests, stop. It is cheap, it never touches anything, and
 * it answers a different question than the one a rehearsal is asked. Constraint
 * violations, ordering problems and schema mismatches all surface at *write*
 * time; a rehearsal that does not write proves the archive is readable and
 * nothing about whether it can be written back.
 *
 * The other alternative — restoring into the live database inside a rolled-back
 * transaction — writes for real and cannot be trusted. A rollback that fails, or
 * a migration that commits on its own, would corrupt the live workspace during a
 * *rehearsal*, which is the one operation that must never be able to.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, type DatabaseHandle, migrate } from "@myownnotion/database";
import pg from "pg";

export interface DisposableWorkspace {
  readonly handle: DatabaseHandle;
  readonly databaseName: string;
  /** A blob root that is just as disposable as the database. */
  readonly blobRoot: string;
  /** Closes the connection and drops the database. Safe to call twice. */
  release(): Promise<void>;
}

/**
 * Creates and migrates a database beside the live one, on the same server.
 *
 * The same server rather than a second one: starting PostgreSQL for a rehearsal
 * would make the safe path expensive, and expense is what stops people
 * rehearsing. Isolation here is a database boundary, which is the boundary that
 * matters — nothing a rehearsal writes can be read by the live connection.
 */
export async function createDisposableWorkspace(
  liveConnectionString: string,
): Promise<DisposableWorkspace> {
  const databaseName = `mon_rehearsal_${randomBytes(8).toString("hex")}`;
  const blobRoot = await mkdtemp(path.join(os.tmpdir(), "mon-rehearsal-blobs-"));

  const admin = new pg.Client({ connectionString: liveConnectionString });
  await admin.connect();
  try {
    // The name is generated here from a fixed alphabet and never comes from an
    // archive or an operator, which is what makes the interpolation safe — the
    // identifier cannot be parameterised.
    await admin.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await admin.end();
  }

  const url = new URL(liveConnectionString);
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  let handle: DatabaseHandle;
  try {
    handle = createDatabase(connectionString);
    await migrate(connectionString);
  } catch (error) {
    // A rehearsal database that cannot be migrated is a rehearsal that cannot
    // start, and leaving it behind would accumulate one per attempt on a server
    // an owner is not watching.
    await dropDatabase(liveConnectionString, databaseName);
    await rm(blobRoot, { recursive: true, force: true });
    throw error;
  }

  let released = false;
  return {
    handle,
    databaseName,
    blobRoot,
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      await handle.close();
      await dropDatabase(liveConnectionString, databaseName);
      await rm(blobRoot, { recursive: true, force: true });
    },
  };
}

async function dropDatabase(liveConnectionString: string, databaseName: string): Promise<void> {
  const admin = new pg.Client({ connectionString: liveConnectionString });
  await admin.connect();
  try {
    // FORCE, because a connection that has not finished closing would otherwise
    // keep the database alive for the next rehearsal to trip over.
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
