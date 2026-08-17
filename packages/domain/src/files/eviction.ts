/**
 * What a device may release when it runs out of room (T035, US4, FR-015, FR-017).
 *
 * Pure, and deliberately so: being wrong here costs an owner work they cannot
 * get back, and that is not something to discover in a browser. The whole rule
 * is one function over a list, testable exhaustively.
 *
 * **Recoverability is what admits content to eviction.** Size and age only
 * order what is already admitted. Said the other way round — evict the biggest
 * thing, or the oldest — is precisely how an unsynchronized change gets
 * released, because unsynchronized changes are often both.
 *
 * Two groups are never touched, and they are checked first rather than sorted
 * last, so no ordering mistake can reach them:
 *
 * 1. work the server does not have — unsynchronized changes, unresolved
 *    conflicts — and the information needed to reach the workspace at all;
 * 2. anything the owner marked to keep offline.
 */

/** One thing a device is holding, described by what matters to the decision. */
export interface EvictionCandidate {
  readonly itemId: string;
  readonly byteLength: number;
  /** Milliseconds since epoch; older is released first within a group. */
  readonly lastAccessedAt: number;
  /**
   * Whether the server can return this content.
   *
   * The single property that admits anything to eviction. False for a local
   * change the server has not accepted, for an unresolved conflict, and for
   * anything whose loss would be permanent.
   */
  readonly recoverable: boolean;
  /** The owner asked for this to stay on this device (FR-016). */
  readonly offlineIntent: boolean;
  /** What it is, which decides the order among recoverable things. */
  readonly kind: "file-content" | "attachment-content" | "page-content" | "metadata";
}

export interface EvictionPlan {
  /** In the order they should be released. */
  readonly release: readonly EvictionCandidate[];
  /** Bytes the plan frees. */
  readonly freedBytes: number;
  /**
   * True when releasing everything permitted still leaves usage above the
   * limit. The client says so rather than pretending the limit was honoured:
   * an owner whose device is genuinely too full needs to know that, and the
   * alternative is releasing something that is not recoverable.
   */
  readonly stillOverLimit: boolean;
}

/** Group order among things that may be released at all. */
const GROUP_ORDER: Record<EvictionCandidate["kind"], number> = {
  "file-content": 0,
  "attachment-content": 1,
  "page-content": 2,
  // Never reached: metadata is filtered out before ordering. Present so the
  // record is total and a new kind cannot be silently ordered first.
  metadata: 99,
};

export function planEviction(input: {
  readonly candidates: readonly EvictionCandidate[];
  readonly usedBytes: number;
  /** `null` means unlimited: nothing is ever released (FR-014). */
  readonly limitBytes: number | null;
}): EvictionPlan {
  if (input.limitBytes === null || input.usedBytes <= input.limitBytes) {
    return { release: [], freedBytes: 0, stillOverLimit: false };
  }

  const evictable = input.candidates.filter(
    (candidate) =>
      candidate.recoverable && !candidate.offlineIntent && candidate.kind !== "metadata",
  );

  const ordered = [...evictable].sort((left, right) => {
    const byGroup = GROUP_ORDER[left.kind] - GROUP_ORDER[right.kind];
    return byGroup !== 0 ? byGroup : left.lastAccessedAt - right.lastAccessedAt;
  });

  const release: EvictionCandidate[] = [];
  let freed = 0;
  for (const candidate of ordered) {
    if (input.usedBytes - freed <= input.limitBytes) {
      break;
    }
    release.push(candidate);
    freed += candidate.byteLength;
  }

  return {
    release,
    freedBytes: freed,
    stillOverLimit: input.usedBytes - freed > input.limitBytes,
  };
}

/**
 * Whether a candidate may ever be released, whatever the pressure.
 *
 * Exported so an interface can explain *why* something was kept, and so the
 * rule has one definition rather than one per caller.
 */
export function isProtected(candidate: EvictionCandidate): boolean {
  return !candidate.recoverable || candidate.offlineIntent || candidate.kind === "metadata";
}
