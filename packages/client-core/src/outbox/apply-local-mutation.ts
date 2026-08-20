/**
 * Atomic optimistic mutation plus outbox persistence (T040, US6, FR-038).
 *
 * The optimistic projection update and the durable outbox entry commit in
 * ONE IndexedDB transaction: success is reported only after both are
 * durable, and a storage failure surfaces visibly instead of pretending
 * acceptance (SC-013).
 */
import {
  type DomainResult,
  err,
  type MutationCommand,
  ok,
  parseMutationCommand,
  type Uuid,
} from "@myownnotion/domain";
import { type LocalDatabase, type OutboxMutationRow, parentKeyOf } from "../local-store/schema.ts";
import type { LocalRecordCodec } from "../security/local-record-codec.ts";
import { applyCommandToProjection, prepareProjectionWrite } from "./apply-to-projection.ts";

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
  codec: LocalRecordCodec,
): Promise<DomainResult<LocalMutationResult>> {
  const parsed = parseMutationCommand(input.commandType, input.payload);
  if (!parsed.ok) {
    return parsed as DomainResult<LocalMutationResult>;
  }
  const command: MutationCommand = parsed.value;

  try {
    // Sealed before the transaction opens, never inside it. Dexie commits a
    // transaction as soon as control returns to the event loop for a non-Dexie
    // promise, and the crypto is one — so sealing inside would end the
    // transaction early and let the writes that follow land outside it.
    //
    // Inside the try, though: preparation is also where a command can be
    // refused on its content (a destructive conversion without confirmation),
    // and that refusal has to come back as a domain error rather than escape
    // as a raw exception.
    const prepared = await prepareProjectionWrite(db, command, codec);

    const localRevisionIds = await db.transaction(
      "rw",
      [
        db.items,
        db.placements,
        db.relationships,
        db.revisionHeaders,
        db.outbox,
        db.meta,
        db.databases,
        db.databaseEntries,
      ],
      async () => {
        const existing = await db.outbox.get(input.mutationId);
        if (existing !== undefined) {
          // Stable mutation identity: re-submission is a no-op (FR-040).
          return existing.localRevisionIds;
        }
        const revisionIds = await applyCommandToProjection(db, command, now, prepared);

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
    | "relationship.endpoint-unavailable"
    | "placement.not-found"
    // Feature 004. The client refuses a destructive conversion for the same
    // reason the server does, and refuses it *first*: applying it optimistically
    // would turn the page into a folder on screen, and only then discover that
    // the server declines. The rule lives in the shared domain, so both sides
    // reach the same answer rather than approximating each other.
    | "conversion.confirmation-required"
    | "database.not-found"
    | "database.entry-not-found"
    | "database.membership-conflict"
    | "database.page-required"
    | "database.projection-unavailable"
    | "database.impact-confirmation-required"
    | "database.impact-stale"
    | "revision.stale-base";
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

export { parentKeyOf };
