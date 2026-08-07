/**
 * Atomic optimistic mutation plus outbox persistence (T040, US6, FR-038).
 *
 * The optimistic projection update and the durable outbox entry commit in
 * ONE IndexedDB transaction: success is reported only after both are
 * durable, and a storage failure surfaces visibly instead of pretending
 * acceptance (SC-013).
 */
import {
  err,
  generateUuidV7,
  ok,
  parseMutationCommand,
  type DomainResult,
  type MutationCommand,
  type Uuid,
} from "@myownnotion/domain";
import { parentKeyOf, type LocalDatabase, type OutboxMutationRow } from "../local-store/schema.ts";
import { applyCommandToProjection } from "./apply-to-projection.ts";

export interface LocalMutationInput {
  readonly mutationId: Uuid;
  readonly commandType: string;
  readonly payload: Record<string, unknown>;
  /** Causal bases for changed items (current local revision heads). */
  readonly baseRevisionIds: ReadonlyArray<Uuid>;
}

export interface LocalMutationResult {
  readonly mutationId: Uuid;
  readonly localRevisionIds: ReadonlyArray<Uuid>;
}

/**
 * Validates, optimistically applies, and enqueues one local mutation.
 * Returns a safe error (without any partial write) when validation or
 * storage fails.
 */
export async function applyLocalMutation(
  db: LocalDatabase,
  input: LocalMutationInput,
  now: () => Date = () => new Date(),
): Promise<DomainResult<LocalMutationResult>> {
  const parsed = parseMutationCommand(input.commandType, input.payload);
  if (!parsed.ok) {
    return parsed as DomainResult<LocalMutationResult>;
  }
  const command: MutationCommand = parsed.value;

  try {
    const localRevisionIds = await db.transaction(
      "rw",
      [db.items, db.placements, db.relationships, db.revisionHeaders, db.outbox, db.meta],
      async () => {
        const existing = await db.outbox.get(input.mutationId);
        if (existing !== undefined) {
          // Stable mutation identity: re-submission is a no-op (FR-040).
          return existing.localRevisionIds;
        }
        const revisionIds = await applyCommandToProjection(db, command, now);

        const enqueueOrder =
          ((await db.outbox.orderBy("enqueueOrder").last())?.enqueueOrder ?? 0) + 1;
        const row: OutboxMutationRow = {
          mutationId: input.mutationId,
          commandType: input.commandType,
          payload: input.payload,
          baseRevisionIds: [...input.baseRevisionIds],
          localRevisionIds: revisionIds,
          status: "pending",
          createdAt: now().toISOString(),
          lastAttemptAt: null,
          enqueueOrder,
        };
        await db.outbox.add(row);
        return revisionIds;
      },
    );
    return ok({ mutationId: input.mutationId, localRevisionIds });
  } catch (error) {
    if (isQuotaError(error)) {
      return err("storage.quota-exceeded", "Local storage quota prevented saving this change");
    }
    if (error instanceof LocalValidationError) {
      return err(error.code, error.message) as DomainResult<LocalMutationResult>;
    }
    return err("storage.unavailable", "Local storage failed while saving this change");
  }
}

export class LocalValidationError extends Error {
  readonly code:
    | "item.not-found"
    | "containment.cycle-rejected"
    | "validation.invalid-payload"
    | "placement.not-found";
  constructor(code: LocalValidationError["code"], message: string) {
    super(message);
    this.name = "LocalValidationError";
    this.code = code;
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "QuotaExceededError" ||
      (error as { inner?: { name?: string } }).inner?.name === "QuotaExceededError")
  );
}

/** Optimistic local revision helper shared with the projection applier. */
export function newLocalRevision(
  db: LocalDatabase,
  itemId: Uuid,
  parentRevisionIds: Uuid[],
  now: () => Date,
): { id: Uuid; write: () => Promise<void> } {
  const id = generateUuidV7();
  return {
    id,
    write: async () => {
      await db.revisionHeaders.put({
        id,
        itemId,
        mutationId: id,
        parentRevisionIds,
        acceptedAt: now().toISOString(),
        local: 1,
      });
    },
  };
}

export { parentKeyOf };
