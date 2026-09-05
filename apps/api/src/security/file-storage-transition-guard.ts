import type { Database, Transaction } from "@myownnotion/database";
import { isUuid } from "@myownnotion/domain";
import { sql } from "drizzle-orm";

export class StorageTransitionPendingError extends Error {
  constructor() {
    super(
      "The protected storage transition is incomplete. Resume the guarded application migration before starting ordinary writes.",
    );
    this.name = "StorageTransitionPendingError";
  }
}

/** A transaction-local marker permits only the migration's own protected writes. */
export async function enterStorageTransition(tx: Transaction, transitionId: string): Promise<void> {
  if (!isUuid(transitionId)) throw new Error("Invalid storage transition identity.");
  await tx.execute(sql`SELECT set_config('myownnotion.storage_transition', ${transitionId}, true)`);
}

/** Must be read after acquiring FILE, so the decision stays valid through publication. */
export async function assertStorageTransitionReady(
  executor: Database | Transaction,
): Promise<void> {
  const result = await executor.execute<{ blocked: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM file_storage_transitions
      WHERE phase <> 'complete'
        AND id::text <> COALESCE(current_setting('myownnotion.storage_transition', true), '')
    ) AS blocked
  `);
  if (result.rows[0]?.blocked !== false) throw new StorageTransitionPendingError();
}
