/**
 * Data-key generation rotation (T084, US5, FR-017, FR-018).
 *
 * The expensive twin of the wrapping-key rotation, and the differences are
 * what make it worth its own module rather than a parameter on the other one.
 *
 * A wrapping-key rotation rewraps one row per workspace and touches no
 * content. This one **re-encrypts every protected record and file chunk**
 * under a new generation, progressively, over what may be a very long time.
 * That single fact drives everything below:
 *
 *   - **the old generation must stay readable throughout.** It becomes
 *     `decrypt-only` rather than being retired, because half the workspace is
 *     still encrypted under it while the rewrite runs. Revoking it early would
 *     make the unrewritten half unreadable — the rotation would destroy
 *     exactly what it was protecting;
 *   - **new writes use the new generation immediately**, from the moment it
 *     exists. Waiting for the rewrite to finish would mean months of writes
 *     under a generation the operator is trying to retire;
 *   - **progress is per record, and resumable.** A rotation that had to start
 *     over after an interruption would never finish on a large workspace.
 *
 * A generation therefore moves `current` → `decrypt-only` → `revoked`, and
 * only reaches `revoked` once nothing is encrypted under it. Those three
 * states are the ones the schema already enforces.
 */

export type GenerationState = "current" | "decrypt-only" | "revoked";

export class DataKeyRotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataKeyRotationError";
  }
}

/**
 * What may follow each generation state.
 *
 * `revoked` is terminal, and a generation cannot go back to `current`:
 * returning to it would mean new writes resuming under a generation the
 * operator already decided to move away from.
 */
const GENERATION_TRANSITIONS: Readonly<Record<GenerationState, readonly GenerationState[]>> = {
  current: ["decrypt-only"],
  "decrypt-only": ["revoked"],
  revoked: [],
};

export function allowedGenerationTransitions(from: GenerationState): readonly GenerationState[] {
  return GENERATION_TRANSITIONS[from];
}

export function canTransitionGeneration(from: GenerationState, to: GenerationState): boolean {
  return GENERATION_TRANSITIONS[from].includes(to);
}

/** Whether a record may be *read* under this generation. */
export function generationPermitsRead(state: GenerationState): boolean {
  // `decrypt-only` exists precisely for this: the unrewritten half of the
  // workspace is still sealed under it and must stay readable.
  return state !== "revoked";
}

/** Whether a new record may be *written* under this generation. */
export function generationPermitsWrite(state: GenerationState): boolean {
  return state === "current";
}

export interface DataKeyRotationProgress {
  readonly operationId: string;
  readonly fromGeneration: number;
  readonly toGeneration: number;
  /** Records and chunks re-encrypted so far. */
  readonly rewrittenCount: number;
  /** Total known at planning time. May grow: the workspace stays writable. */
  readonly totalCount: number;
  /** Where the sweep had reached, as an opaque ordered cursor. */
  readonly cursor: string;
}

export function planDataKeyRotation(input: {
  operationId: string;
  fromGeneration: number;
  toGeneration: number;
  totalCount: number;
}): DataKeyRotationProgress {
  if (!Number.isInteger(input.toGeneration) || input.toGeneration <= input.fromGeneration) {
    throw new DataKeyRotationError(
      `a rotation must advance the generation (from ${input.fromGeneration} to ${input.toGeneration})`,
    );
  }
  if (!Number.isInteger(input.totalCount) || input.totalCount < 0) {
    throw new DataKeyRotationError("totalCount must be a non-negative integer");
  }
  return {
    operationId: input.operationId,
    fromGeneration: input.fromGeneration,
    toGeneration: input.toGeneration,
    rewrittenCount: 0,
    totalCount: input.totalCount,
    cursor: "",
  };
}

/**
 * Advances progress after a batch.
 *
 * The cursor must move forward. A cursor that went backwards would re-sweep
 * records already rewritten, which is harmless in isolation but hides a bug
 * that would otherwise surface: something is producing stale positions, and
 * on a long rotation that can mean the sweep never terminates.
 */
export function advanceDataKeyRotation(
  progress: DataKeyRotationProgress,
  batch: { cursor: string; rewritten: number },
): DataKeyRotationProgress {
  if (batch.cursor <= progress.cursor && progress.cursor !== "") {
    throw new DataKeyRotationError(
      `a rotation cursor must move forward (${progress.cursor} -> ${batch.cursor})`,
    );
  }
  if (!Number.isInteger(batch.rewritten) || batch.rewritten < 0) {
    throw new DataKeyRotationError("a batch must rewrite a non-negative number of records");
  }
  return {
    ...progress,
    cursor: batch.cursor,
    rewrittenCount: progress.rewrittenCount + batch.rewritten,
    // The total may grow: the workspace stays writable during the rotation, and
    // records written under the new generation need no rewrite, but ones
    // written under the old one before the sweep passed do.
    totalCount: Math.max(progress.totalCount, progress.rewrittenCount + batch.rewritten),
  };
}

/**
 * Whether the old generation may now be revoked.
 *
 * Revoking early is the one irreversible mistake available here: every record
 * still sealed under it becomes permanently unreadable. So this asks for a
 * definite answer — nothing remains — rather than inferring completion from a
 * count that may have grown while the sweep ran.
 */
export function mayRevokeGeneration(input: {
  progress: DataKeyRotationProgress;
  remainingUnderOldGeneration: number;
}): boolean {
  return input.remainingUnderOldGeneration === 0;
}

/** Progress as a fraction, for a display that must not claim false precision. */
export function rotationCompletion(progress: DataKeyRotationProgress): number {
  if (progress.totalCount === 0) {
    return 1;
  }
  return Math.min(1, progress.rewrittenCount / progress.totalCount);
}
