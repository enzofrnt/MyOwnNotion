import { and, asc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { fileStorageTransitionEntries, fileStorageTransitions } from "../../schema/index.ts";

export type StorageTransitionRecord = typeof fileStorageTransitions.$inferSelect;
export type StorageTransitionEntry = typeof fileStorageTransitionEntries.$inferSelect;
export type StorageTransitionPhase =
  | "inventoried"
  | "backfilling"
  | "metadata-protected"
  | "verified"
  | "cutover"
  | "retiring-sources"
  | "complete";
export type StorageSourcePhase = "inventoried" | "published" | "verified" | "retired";

export async function readStorageTransition(
  executor: Database | Transaction,
  installationId: string,
): Promise<StorageTransitionRecord | null> {
  return (
    (
      await executor
        .select()
        .from(fileStorageTransitions)
        .where(eq(fileStorageTransitions.installationId, installationId))
        .limit(1)
    )[0] ?? null
  );
}

export async function insertStorageTransition(
  tx: Transaction,
  input: typeof fileStorageTransitions.$inferInsert,
): Promise<void> {
  await tx.insert(fileStorageTransitions).values(input);
}

export async function insertStorageSource(
  tx: Transaction,
  input: typeof fileStorageTransitionEntries.$inferInsert,
): Promise<void> {
  await tx.insert(fileStorageTransitionEntries).values(input);
}

export async function nextStorageSource(
  executor: Database | Transaction,
  transitionId: string,
  phase: StorageSourcePhase,
): Promise<StorageTransitionEntry | null> {
  return (
    (
      await executor
        .select()
        .from(fileStorageTransitionEntries)
        .where(
          and(
            eq(fileStorageTransitionEntries.transitionId, transitionId),
            eq(fileStorageTransitionEntries.phase, phase),
          ),
        )
        .orderBy(asc(fileStorageTransitionEntries.id))
        .limit(1)
    )[0] ?? null
  );
}

/** Compare the expected durable phase, so stale callers cannot advance a checkpoint. */
export async function advanceStorageSource(
  tx: Transaction,
  input: {
    id: string;
    from: StorageSourcePhase;
    to: StorageSourcePhase;
    replacementEnvelopeId?: string;
    now: Date;
  },
): Promise<void> {
  const changed = await tx
    .update(fileStorageTransitionEntries)
    .set({
      phase: input.to,
      updatedAt: input.now,
      ...(input.replacementEnvelopeId === undefined
        ? {}
        : { replacementEnvelopeId: input.replacementEnvelopeId }),
    })
    .where(
      and(
        eq(fileStorageTransitionEntries.id, input.id),
        eq(fileStorageTransitionEntries.phase, input.from),
      ),
    )
    .returning({ id: fileStorageTransitionEntries.id });
  if (changed.length !== 1) throw new Error("The storage source checkpoint changed concurrently.");
}

export async function advanceStorageTransition(
  tx: Transaction,
  input: { id: string; from: StorageTransitionPhase; to: StorageTransitionPhase; now: Date },
): Promise<void> {
  const changed = await tx
    .update(fileStorageTransitions)
    .set({
      phase: input.to,
      updatedAt: input.now,
      completedAt: input.to === "complete" ? input.now : null,
    })
    .where(
      and(eq(fileStorageTransitions.id, input.id), eq(fileStorageTransitions.phase, input.from)),
    )
    .returning({ id: fileStorageTransitions.id });
  if (changed.length !== 1)
    throw new Error("The storage transition checkpoint changed concurrently.");
}
