/**
 * Installation invariants (T018, feature 002).
 *
 * One installation, one owner, one workspace — and the transition between "no
 * owner" and "one owner" is a single atomic step with nothing observable in
 * between.
 *
 * The invariant that carries the most weight is the count rule: an
 * installation reports `ownerCount=0` / `workspaceCount=0` in every
 * uninitialized state and `1/1` in every initialized state, with no third
 * possibility. A half-committed bootstrap — an owner row with no workspace, or
 * a workspace bound to no owner — would be a usable partial installation, and
 * the whole point of the atomic promotion is that such a thing never exists.
 *
 * These are pure predicates. Enforcement lives in the database (unique indexes
 * on constant expressions, serializable transactions); this module is what
 * lets the domain, the API, and the tests agree on what the database is
 * enforcing.
 */
import {
  INITIALIZED_COUNTS,
  INITIALIZED_INSTALLATION_STATES,
  type InstallationCounts,
  type InstallationState,
  UNINITIALIZED_COUNTS,
  UNINITIALIZED_INSTALLATION_STATES,
} from "./types.ts";

export function isInitializedState(state: InstallationState): boolean {
  return (INITIALIZED_INSTALLATION_STATES as readonly string[]).includes(state);
}

export function isUninitializedState(state: InstallationState): boolean {
  return (UNINITIALIZED_INSTALLATION_STATES as readonly string[]).includes(state);
}

/** The counts an installation in `state` must report. */
export function expectedCountsFor(state: InstallationState): InstallationCounts {
  return isInitializedState(state) ? INITIALIZED_COUNTS : UNINITIALIZED_COUNTS;
}

export class InstallationInvariantError extends Error {
  constructor(
    message: string,
    readonly state: InstallationState,
    readonly counts: { ownerCount: number; workspaceCount: number },
  ) {
    super(message);
    this.name = "InstallationInvariantError";
  }
}

/**
 * Describes every way the observed counts disagree with the state, or an empty
 * array when they agree. Returning the list rather than a boolean means the
 * caller can log exactly which invariant broke without re-deriving it.
 */
export function checkInstallationCounts(
  state: InstallationState,
  counts: { ownerCount: number; workspaceCount: number },
): string[] {
  const expected = expectedCountsFor(state);
  const problems: string[] = [];

  if (counts.ownerCount !== expected.ownerCount) {
    problems.push(
      `state ${state} requires ownerCount=${expected.ownerCount}, observed ${counts.ownerCount}`,
    );
  }
  if (counts.workspaceCount !== expected.workspaceCount) {
    problems.push(
      `state ${state} requires workspaceCount=${expected.workspaceCount}, observed ${counts.workspaceCount}`,
    );
  }
  // Checked independently of the state, because a mismatched pair is a broken
  // atomic promotion whichever state claims to be in force.
  if (counts.ownerCount !== counts.workspaceCount) {
    problems.push(
      `owner and workspace counts must move together (observed ${counts.ownerCount}/${counts.workspaceCount}); ` +
        "a partial installation means the promotion was not atomic",
    );
  }
  if (counts.ownerCount > 1 || counts.workspaceCount > 1) {
    problems.push(
      `this product has exactly one owner and one workspace (observed ${counts.ownerCount}/${counts.workspaceCount})`,
    );
  }
  return problems;
}

/** Throws when the counts and the state disagree. */
export function assertInstallationCounts(
  state: InstallationState,
  counts: { ownerCount: number; workspaceCount: number },
): void {
  const problems = checkInstallationCounts(state, counts);
  if (problems.length > 0) {
    throw new InstallationInvariantError(problems.join("; "), state, counts);
  }
}

/**
 * Whether protected reads and writes may proceed.
 *
 * `degraded` means the deployment key is unavailable or invalid: the
 * installation keeps its owner and workspace, but every protected operation
 * fails closed rather than guessing. `migration-in-progress` still serves
 * reads; write eligibility there is decided by the migration state, not here.
 */
export function protectedOperationsAvailable(state: InstallationState): boolean {
  return state === "ready" || state === "migration-in-progress";
}

/**
 * Whether an owner-facing session may be established at all. A bootstrap runs
 * without a session by construction, so no uninitialized state qualifies.
 */
export function sessionsPermitted(state: InstallationState): boolean {
  return isInitializedState(state) && state !== "degraded";
}

/**
 * Whether the installation still requires the owner to replace recovery
 * material before normal use.
 */
export function recoveryOutstanding(state: InstallationState): boolean {
  return state === "recovery-required";
}
