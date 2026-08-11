/**
 * Session-free bootstrap state machine (T029, feature 002).
 *
 * Bootstrap is the only path that creates ownership, and it must work before
 * any session can exist — a session requires an owner, and there is no owner
 * yet. Authority therefore comes from a capability the browser holds for the
 * duration of one attempt, not from a cookie.
 *
 * The property everything else hangs on: **every state before `confirmed` is
 * attempt-scoped.** Records exist, credentials are verified, a kit is
 * prepared — and the installation still reports `ownerCount=0` /
 * `workspaceCount=0`, because none of it is committed ownership. A single
 * atomic promotion moves `0/0` to `1/1`. There is no instant in between, so a
 * crash, a race, or a refused request can never leave a usable half-owner.
 *
 * Three rules that are easy to get subtly wrong, and are enforced here rather
 * than in the service layer where a caller could forget them:
 *
 *   1. **Confirmation requires a consumed download.** Downloading the recovery
 *      kit is not the same as confirming it was stored offline. Collapsing the
 *      two would let an owner reach `ready` with a kit they never saved.
 *   2. **Regeneration stays on the same attempt.** A new kit reuses the
 *      verified `attemptId` and the browser-held capability; the previous kit
 *      becomes `rejected/expired` and is never revived.
 *   3. **The 15-minute window is enforced on transition, not on read.** A
 *      request that arrives late fails, even if the clock was fine when the
 *      attempt started.
 */

import {
  BOOTSTRAP_CLAIM_WINDOW_MINUTES,
  BOOTSTRAP_KIT_WINDOW_MINUTES,
  type BootstrapState,
  INITIALIZED_COUNTS,
  type InstallationCounts,
  UNINITIALIZED_COUNTS,
} from "./types.ts";

export { BOOTSTRAP_CLAIM_WINDOW_MINUTES, BOOTSTRAP_KIT_WINDOW_MINUTES };

/** States in which the attempt is still live and can progress. */
export const OPEN_BOOTSTRAP_STATES = [
  "started",
  "credential-verified",
  "recovery-prepared",
  "download-consumed",
] as const;

/** States from which nothing further happens. */
export const TERMINAL_BOOTSTRAP_STATES = ["confirmed", "abandoned", "rejected"] as const;

export function isOpenBootstrapState(state: BootstrapState): boolean {
  return (OPEN_BOOTSTRAP_STATES as readonly string[]).includes(state);
}

export function isTerminalBootstrapState(state: BootstrapState): boolean {
  return (TERMINAL_BOOTSTRAP_STATES as readonly string[]).includes(state);
}

/**
 * Committed counts for a bootstrap state.
 *
 * Only `confirmed` is `1/1`. Everything else — including `rejected` and
 * `abandoned`, which have real durable records — is `0/0`, because those
 * records are attempt-scoped and never constitute ownership.
 */
export function countsForBootstrapState(state: BootstrapState): InstallationCounts {
  return state === "confirmed" ? INITIALIZED_COUNTS : UNINITIALIZED_COUNTS;
}

/**
 * The transition table.
 *
 * Note what is absent: there is no edge from `credential-verified` or
 * `recovery-prepared` straight to `confirmed`. The only route runs through
 * `download-consumed`, which is what makes offline confirmation mandatory
 * rather than advisory.
 */
const TRANSITIONS: Readonly<Record<BootstrapState, readonly BootstrapState[]>> = {
  started: ["credential-verified", "abandoned", "rejected"],
  "credential-verified": ["recovery-prepared", "abandoned", "rejected"],
  // The self-loop is regeneration before any download: the owner never
  // received a usable kit, or the window lapsed, and asks for another.
  "recovery-prepared": ["download-consumed", "recovery-prepared", "abandoned", "rejected"],
  // `recovery-prepared` is reachable again from here, and only here, for
  // regeneration. An owner who downloaded the kit and then lost the file
  // before confirming can otherwise neither confirm (no kit) nor download
  // again (one-time), and their only escape would be to abandon the attempt
  // and re-verify their credential. The replacement kit is new; the one it
  // supersedes becomes `rejected/expired` and is never revived.
  "download-consumed": ["confirmed", "recovery-prepared", "abandoned", "rejected"],
  confirmed: [],
  abandoned: [],
  rejected: [],
};

export function allowedBootstrapTransitions(from: BootstrapState): readonly BootstrapState[] {
  return TRANSITIONS[from];
}

export function canTransitionBootstrap(from: BootstrapState, to: BootstrapState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class BootstrapTransitionError extends Error {
  constructor(
    readonly from: BootstrapState,
    readonly to: BootstrapState,
    reason?: string,
  ) {
    super(
      `illegal bootstrap transition ${from} -> ${to}${reason === undefined ? "" : `: ${reason}`}`,
    );
    this.name = "BootstrapTransitionError";
  }
}

/**
 * One bootstrap attempt.
 *
 * There is deliberately no `ownerId` and no `workspaceId`: an attempt that
 * carried either would make the `0/0` claim unverifiable, and would invite a
 * service to write an owner row before confirmation.
 */
export interface BootstrapAttempt {
  readonly attemptId: string;
  readonly installationId: string;
  readonly state: BootstrapState;
  /** Hash of the browser-held capability. The capability itself never lands. */
  readonly capabilityHash: string;
  readonly clientNonceHash: string;
  readonly challengeHash: string | null;
  readonly credentialVerified: boolean;
  readonly recoveryKitId: string | null;
  readonly downloadTokenHash: string | null;
  readonly downloadExpiresAt: Date | null;
  readonly downloadConsumedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BootstrapClock {
  readonly now: Date;
}

export function startAttempt(input: {
  attemptId: string;
  installationId: string;
  capabilityHash: string;
  clientNonceHash: string;
  now: Date;
}): BootstrapAttempt {
  return {
    attemptId: input.attemptId,
    installationId: input.installationId,
    state: "started",
    capabilityHash: input.capabilityHash,
    clientNonceHash: input.clientNonceHash,
    challengeHash: null,
    credentialVerified: false,
    recoveryKitId: null,
    downloadTokenHash: null,
    downloadExpiresAt: null,
    downloadConsumedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The instant a download window opened at `verifiedAt` closes. */
export function downloadWindowEnd(verifiedAt: Date): Date {
  return new Date(verifiedAt.getTime() + BOOTSTRAP_KIT_WINDOW_MINUTES * 60_000);
}

export function isDownloadWindowOpen(attempt: BootstrapAttempt, now: Date): boolean {
  return attempt.downloadExpiresAt !== null && now.getTime() <= attempt.downloadExpiresAt.getTime();
}

/**
 * Records a verified credential. The attempt stays `0/0`: verified credential
 * material is held against the attempt, not promoted to an owner credential.
 */
export function recordCredentialVerified(
  attempt: BootstrapAttempt,
  input: { challengeHash: string; now: Date },
): BootstrapAttempt {
  assertTransition(attempt, "credential-verified");
  return {
    ...attempt,
    state: "credential-verified",
    challengeHash: input.challengeHash,
    credentialVerified: true,
    updatedAt: input.now,
  };
}

/**
 * Prepares the one provisional kit and opens its single 15-minute window.
 *
 * Called again for a regeneration: the same attempt, the same capability, a
 * new kit and a new window. The caller is responsible for rejecting the
 * previous kit, which `regenerationSupersedes` describes.
 */
export function prepareRecovery(
  attempt: BootstrapAttempt,
  input: { recoveryKitId: string; downloadTokenHash: string; now: Date },
): BootstrapAttempt {
  if (!attempt.credentialVerified) {
    throw new BootstrapTransitionError(
      attempt.state,
      "recovery-prepared",
      "no verified credential is held for this attempt",
    );
  }
  if (
    !canTransitionBootstrap(attempt.state, "recovery-prepared") &&
    attempt.state !== "credential-verified"
  ) {
    throw new BootstrapTransitionError(attempt.state, "recovery-prepared");
  }
  return {
    ...attempt,
    state: "recovery-prepared",
    recoveryKitId: input.recoveryKitId,
    downloadTokenHash: input.downloadTokenHash,
    downloadExpiresAt: downloadWindowEnd(input.now),
    // A regenerated kit has never been downloaded, whatever the previous one did.
    downloadConsumedAt: null,
    updatedAt: input.now,
  };
}

/**
 * What regeneration does to the previous kit: it is rejected and expired, and
 * it is never revived. Returned as data so the repository writes it in the
 * same transaction that prepares the replacement.
 */
export function regenerationSupersedes(attempt: BootstrapAttempt): {
  readonly previousKitId: string | null;
  readonly previousAuthorizationState: "rejected";
  readonly previousDeliveryState: "expired";
} {
  return {
    previousKitId: attempt.recoveryKitId,
    previousAuthorizationState: "rejected",
    previousDeliveryState: "expired",
  };
}

/**
 * Consumes the one download.
 *
 * Refuses a second consumption and a late one. The window is checked here, on
 * the transition, rather than when the attempt is read: a request that arrives
 * after the window closed must fail even though the attempt looked fine when
 * it started.
 */
export function consumeDownload(
  attempt: BootstrapAttempt,
  input: { downloadTokenHash: string; now: Date },
): BootstrapAttempt {
  assertTransition(attempt, "download-consumed");
  if (attempt.downloadTokenHash === null || attempt.downloadTokenHash !== input.downloadTokenHash) {
    throw new BootstrapTransitionError(
      attempt.state,
      "download-consumed",
      "download token does not match this attempt",
    );
  }
  if (attempt.downloadConsumedAt !== null) {
    throw new BootstrapTransitionError(
      attempt.state,
      "download-consumed",
      "the one-time download has already been consumed",
    );
  }
  if (!isDownloadWindowOpen(attempt, input.now)) {
    throw new BootstrapTransitionError(
      attempt.state,
      "download-consumed",
      "the download window has closed",
    );
  }
  return {
    ...attempt,
    state: "download-consumed",
    downloadConsumedAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * The explicit offline confirmation that authorises the atomic promotion.
 *
 * Requires a consumed download and an open window. Confirming after the window
 * closed would mean the owner is attesting to a kit whose delivery already
 * expired — regeneration is the correct path there.
 */
export function confirmOfflineStorage(
  attempt: BootstrapAttempt,
  input: { now: Date },
): BootstrapAttempt {
  assertTransition(attempt, "confirmed");
  if (attempt.downloadConsumedAt === null) {
    throw new BootstrapTransitionError(
      attempt.state,
      "confirmed",
      "confirmation requires a consumed recovery download",
    );
  }
  if (!isDownloadWindowOpen(attempt, input.now)) {
    throw new BootstrapTransitionError(
      attempt.state,
      "confirmed",
      "the download window has closed; regenerate the kit",
    );
  }
  return { ...attempt, state: "confirmed", updatedAt: input.now };
}

/**
 * Whether an open attempt has sat long enough that a new claim may take over.
 *
 * Two deadlines, because an attempt has two stages. Once a kit is prepared the
 * download window governs. Before that there is no kit and no download
 * deadline, so the claim window governs — and that earlier stage is precisely
 * where an abandoned attempt used to be immortal, holding the installation's
 * only bootstrap slot with nothing to expire it.
 *
 * A terminal attempt is never stale: it is already finished, and the partial
 * unique index does not count it as open.
 */
export function isAttemptStale(attempt: BootstrapAttempt, now: Date): boolean {
  if (isTerminalBootstrapState(attempt.state)) {
    return false;
  }
  const deadline =
    attempt.downloadExpiresAt ??
    new Date(attempt.createdAt.getTime() + BOOTSTRAP_CLAIM_WINDOW_MINUTES * 60_000);
  return now.getTime() > deadline.getTime();
}

export function abandonAttempt(attempt: BootstrapAttempt, now: Date): BootstrapAttempt {
  assertTransition(attempt, "abandoned");
  return { ...attempt, state: "abandoned", updatedAt: now };
}

export function rejectAttempt(attempt: BootstrapAttempt, now: Date): BootstrapAttempt {
  assertTransition(attempt, "rejected");
  return { ...attempt, state: "rejected", updatedAt: now };
}

/**
 * Expires an attempt whose window has closed without confirmation.
 *
 * A `confirmed` attempt is never expired by this: confirmation outlives the
 * delivery window, only the delivery does not.
 */
export function expireAttemptIfDue(attempt: BootstrapAttempt, now: Date): BootstrapAttempt {
  if (isTerminalBootstrapState(attempt.state) || isDownloadWindowOpen(attempt, now)) {
    return attempt;
  }
  return attempt.downloadExpiresAt === null ? attempt : rejectAttempt(attempt, now);
}

function assertTransition(attempt: BootstrapAttempt, to: BootstrapState): void {
  if (!canTransitionBootstrap(attempt.state, to)) {
    throw new BootstrapTransitionError(attempt.state, to);
  }
}

// ---------------------------------------------------------------------------
// Capability verification
// ---------------------------------------------------------------------------

export class BootstrapCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootstrapCapabilityError";
  }
}

/**
 * Verifies the browser-held capability against the attempt it claims.
 *
 * Both the attempt ID **and** the capability hash must match. Checking the
 * capability alone would let it be replayed against a different attempt;
 * checking the attempt alone would make the capability decorative.
 *
 * `compare` is injected so the caller supplies a constant-time comparison —
 * this module stays free of `node:crypto` for the platform-independent build.
 */
export function verifyAttemptCapability(
  attempt: BootstrapAttempt,
  presented: { attemptId: string; capabilityHash: string },
  compare: (left: string, right: string) => boolean,
): void {
  if (attempt.attemptId !== presented.attemptId) {
    throw new BootstrapCapabilityError("capability does not belong to this attempt");
  }
  if (!compare(attempt.capabilityHash, presented.capabilityHash)) {
    throw new BootstrapCapabilityError("capability does not match this attempt");
  }
  if (isTerminalBootstrapState(attempt.state)) {
    throw new BootstrapCapabilityError("this bootstrap attempt is no longer open");
  }
}

/**
 * Whether readiness may be declared.
 *
 * Deliberately not "the owner exists": readiness also requires the recovery
 * kit to be confirmed. An installation with an owner and no confirmed offline
 * recovery is one lost device away from unrecoverable, which is the outcome
 * the whole bootstrap flow exists to prevent.
 */
export function readinessSatisfied(input: {
  bootstrapState: BootstrapState;
  recoveryAuthorizationState: string;
  recoveryDeliveryState: string;
}): boolean {
  return (
    input.bootstrapState === "confirmed" &&
    input.recoveryAuthorizationState === "active" &&
    input.recoveryDeliveryState === "confirmed"
  );
}
