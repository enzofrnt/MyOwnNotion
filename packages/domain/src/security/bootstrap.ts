/**
 * Session-free bootstrap state machine (T029 / T130, feature 002).
 *
 * Bootstrap is the only path that creates ownership, and it must work before
 * any session can exist — a session requires an owner, and there is no owner
 * yet. Authority therefore comes from a capability the browser holds for the
 * duration of one attempt, not from a cookie.
 *
 * The property everything else hangs on: **every state before `confirmed` is
 * attempt-scoped.** Records exist, credentials are verified, a password is
 * recorded — and the installation still reports `ownerCount=0` /
 * `workspaceCount=0`, because none of it is committed ownership. A single
 * atomic promotion moves `0/0` to `1/1`. There is no instant in between, so a
 * crash, a race, or a refused request can never leave a usable half-owner.
 *
 * Happy path (2026-09-22 clarifications):
 *
 *   `started` → `credential-verified` → `password-set` → `confirmed`
 *
 * Incomplete attempts never commit ownership. Starting a new claim while still
 * `0/0` abandons any incomplete open attempt so another browser can finish.
 * Recovery-kit download and offline confirmation are settings concerns after
 * readiness; they are not bootstrap steps.
 *
 * Legacy kit-era states (`recovery-prepared`, `download-consumed`) remain
 * readable for older rows and may still be abandoned, but new attempts never
 * enter them.
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
  "password-set",
  // Legacy kit-era open states: still abandonable, never entered by new flows.
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
 * Happy path: credential verification, then password, then confirmation.
 * Legacy kit-era edges remain so old rows and tests can still abandon or
 * regenerate historical attempts; new services must not drive them.
 */
const TRANSITIONS: Readonly<Record<BootstrapState, readonly BootstrapState[]>> = {
  started: ["credential-verified", "abandoned", "rejected"],
  "credential-verified": ["password-set", "abandoned", "rejected", "recovery-prepared"],
  "password-set": ["confirmed", "abandoned", "rejected"],
  // Legacy kit-era transitions — kept for readable old rows only.
  "recovery-prepared": ["download-consumed", "recovery-prepared", "abandoned", "rejected"],
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
 * Records an acceptable password alternative against the same attempt.
 *
 * Still `0/0`: the password hash is pending material until confirmation.
 */
export function recordPasswordSet(
  attempt: BootstrapAttempt,
  input: { now: Date },
): BootstrapAttempt {
  if (!attempt.credentialVerified) {
    throw new BootstrapTransitionError(
      attempt.state,
      "password-set",
      "no verified credential is held for this attempt",
    );
  }
  assertTransition(attempt, "password-set");
  return {
    ...attempt,
    state: "password-set",
    updatedAt: input.now,
  };
}

/**
 * Prepares the one provisional kit and opens its single 15-minute window.
 *
 * Legacy kit-era helper. Kept for older rows and tests; the happy path never
 * calls it. Called again for a regeneration: the same attempt, the same
 * capability, a new kit and a new window. The caller is responsible for
 * rejecting the previous kit, which `regenerationSupersedes` describes.
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
 * Legacy kit-era helper. Refuses a second consumption and a late one. The
 * window is checked here, on the transition, rather than when the attempt is
 * read.
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
 * Confirms the attempt and authorises the atomic promotion.
 *
 * Happy path: requires `password-set`. Legacy kit-era path from
 * `download-consumed` still works for older rows that already consumed a kit.
 */
export function confirmBootstrap(
  attempt: BootstrapAttempt,
  input: { now: Date },
): BootstrapAttempt {
  assertTransition(attempt, "confirmed");
  if (attempt.state === "password-set") {
    return { ...attempt, state: "confirmed", updatedAt: input.now };
  }
  // Legacy: confirmation after a consumed download still requires an open window.
  if (attempt.downloadConsumedAt === null) {
    throw new BootstrapTransitionError(
      attempt.state,
      "confirmed",
      "confirmation requires a password or a consumed recovery download",
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
 * @deprecated Use {@link confirmBootstrap}. Kept as an alias for legacy callers.
 */
export function confirmOfflineStorage(
  attempt: BootstrapAttempt,
  input: { now: Date },
): BootstrapAttempt {
  return confirmBootstrap(attempt, input);
}

/**
 * Whether an open attempt has sat long enough that a new claim may take over.
 *
 * With the 2026-09-22 clarifications, any incomplete open attempt is
 * supersedable regardless of staleness — this helper remains for diagnostics
 * and claim-window messaging. A terminal attempt is never stale.
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
 * delivery window, only the delivery does not. Attempts on the password happy
 * path have no download window and are not expired here.
 */
export function expireAttemptIfDue(attempt: BootstrapAttempt, now: Date): BootstrapAttempt {
  if (isTerminalBootstrapState(attempt.state) || attempt.downloadExpiresAt === null) {
    return attempt;
  }
  if (isDownloadWindowOpen(attempt, now)) {
    return attempt;
  }
  return rejectAttempt(attempt, now);
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
 * Whether bootstrap confirmation completed.
 *
 * Recovery-kit readiness is a separate settings concern after ownership
 * commits; confirmed bootstrap alone means the installation is ready.
 */
export function readinessSatisfied(input: {
  bootstrapState: BootstrapState;
  recoveryAuthorizationState?: string;
  recoveryDeliveryState?: string;
}): boolean {
  return input.bootstrapState === "confirmed";
}
