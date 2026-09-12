/** Database-local advisory keys require no application table or migration. */
import type { Transaction } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import type pg from "pg";

const NAMESPACE = 0x4d4f4e;
const RUN = 2401;
const FILE_MUTATION = 2402;
const BLOB_DELETION = 2403;

export async function acquireFullRunLock(client: pg.Client): Promise<() => Promise<void>> {
  await client.query("SELECT pg_advisory_lock($1, $2)", [NAMESPACE, RUN]);
  return async () => {
    await client.query("SELECT pg_advisory_unlock($1, $2)", [NAMESPACE, RUN]);
  };
}

/** Always before an upload row lock; released by the surrounding transaction. */
export async function shareFullFileMutation(tx: Transaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${NAMESPACE}, ${FILE_MUTATION})`);
}

/** Physical GC must hold this through the actual delete, not only the DB update. */
export async function shareFullBlobDeletion(tx: Transaction): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${NAMESPACE}, ${BLOB_DELETION})`);
}

/** Acquire before beginning the exported snapshot so waits cannot age the snapshot. */
export interface FullBackupLockRelease {
  (): Promise<void>;
  releaseFiles(): Promise<void>;
}

export async function acquireFullBackupLocks(client: pg.Client): Promise<FullBackupLockRelease> {
  const acquired: number[] = [];
  const release = async () => {
    for (const key of acquired.splice(0).reverse()) {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [NAMESPACE, key]);
    }
  };
  try {
    for (const key of [RUN, FILE_MUTATION, BLOB_DELETION]) {
      await client.query("SELECT pg_advisory_lock($1, $2)", [NAMESPACE, key]);
      acquired.push(key);
    }
    return Object.assign(release, {
      releaseFiles: async () => {
        for (const key of [BLOB_DELETION, FILE_MUTATION]) {
          const index = acquired.indexOf(key);
          if (index === -1) continue;
          await client.query("SELECT pg_advisory_unlock($1, $2)", [NAMESPACE, key]);
          acquired.splice(index, 1);
        }
      },
    });
  } catch (error) {
    await release();
    throw error;
  }
}
