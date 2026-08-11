/**
 * Owner session policy (T044, feature 002).
 *
 * Session lifetime decisions live here, away from storage and transport, so
 * they can be exercised against an injected clock rather than by waiting.
 * Every function takes `now` explicitly: a policy that reads the wall clock
 * cannot be tested at its boundaries, and its boundaries are the only part
 * that matters.
 *
 * Three rules the module exists to hold:
 *
 *   - **Inactivity is measured from last activity, never from issuance.** A
 *     session in daily use must not expire on a fixed schedule, and one
 *     abandoned an hour after issue must not survive for a month.
 *   - **Recent authentication is a separate clock from the session.** A valid
 *     session is not permission to enrol a credential or revoke everything;
 *     those require proof of possession *now*. Folding the two together would
 *     mean a thirty-day-old session could change the password.
 *   - **A revoked session is dead immediately and permanently.** Not "expired
 *     sooner": revocation is a decision the owner made, and no amount of
 *     subsequent activity may revive it.
 */

import {
  DEFAULT_RECENT_AUTH_MINUTES,
  DEFAULT_SESSION_INACTIVITY_DAYS,
  MAX_RECENT_AUTH_MINUTES,
  MAX_SESSION_INACTIVITY_DAYS,
  MIN_RECENT_AUTH_MINUTES,
  MIN_SESSION_INACTIVITY_DAYS,
} from "./types.ts";

export {
  DEFAULT_RECENT_AUTH_MINUTES,
  DEFAULT_SESSION_INACTIVITY_DAYS,
  MAX_RECENT_AUTH_MINUTES,
  MAX_SESSION_INACTIVITY_DAYS,
  MIN_RECENT_AUTH_MINUTES,
  MIN_SESSION_INACTIVITY_DAYS,
};

export const SESSION_STATES = ["active", "revoked", "expired"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** The protected local CLI never holds a session, so it is never a method. */
export const SESSION_AUTH_METHODS = ["passkey", "password"] as const;
export type SessionAuthMethod = (typeof SESSION_AUTH_METHODS)[number];

export interface SessionRecord {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly deviceId: string;
  readonly authMethod: SessionAuthMethod;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly recentAuthAt: Date;
  readonly state: SessionState;
  readonly revokedAt: Date | null;
}

export class SessionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionPolicyError";
  }
}

/**
 * Validated session-lifetime configuration.
 *
 * Constructed through {@link sessionPolicy}, which refuses out-of-range values
 * rather than clamping them. Clamping would let a deployment ask for a
 * 365-day session, get 90, and never learn that its stated policy is not the
 * one in force.
 */
export interface SessionPolicy {
  readonly inactivityDays: number;
  readonly recentAuthMinutes: number;
}

export function sessionPolicy(
  input: { inactivityDays?: number; recentAuthMinutes?: number } = {},
): SessionPolicy {
  const inactivityDays = input.inactivityDays ?? DEFAULT_SESSION_INACTIVITY_DAYS;
  const recentAuthMinutes = input.recentAuthMinutes ?? DEFAULT_RECENT_AUTH_MINUTES;

  if (!Number.isInteger(inactivityDays)) {
    throw new SessionPolicyError("session inactivity must be a whole number of days");
  }
  if (
    inactivityDays < MIN_SESSION_INACTIVITY_DAYS ||
    inactivityDays > MAX_SESSION_INACTIVITY_DAYS
  ) {
    throw new SessionPolicyError(
      `session inactivity must be between ${MIN_SESSION_INACTIVITY_DAYS} and ${MAX_SESSION_INACTIVITY_DAYS} days; got ${inactivityDays}`,
    );
  }
  if (!Number.isInteger(recentAuthMinutes)) {
    throw new SessionPolicyError("recent authentication must be a whole number of minutes");
  }
  if (recentAuthMinutes < MIN_RECENT_AUTH_MINUTES || recentAuthMinutes > MAX_RECENT_AUTH_MINUTES) {
    throw new SessionPolicyError(
      `recent authentication must be between ${MIN_RECENT_AUTH_MINUTES} and ${MAX_RECENT_AUTH_MINUTES} minutes; got ${recentAuthMinutes}`,
    );
  }
  return { inactivityDays, recentAuthMinutes };
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60_000);
}

/** When a session last seen at `lastSeenAt` would lapse. */
export function inactivityDeadline(lastSeenAt: Date, policy: SessionPolicy): Date {
  return addDays(lastSeenAt, policy.inactivityDays);
}

export interface IssueSessionInput {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly deviceId: string;
  readonly authMethod: SessionAuthMethod;
  readonly now: Date;
}

/**
 * The session a successful authentication produces.
 *
 * `recentAuthAt` starts at `now` because the owner has just proved possession.
 * That is the only moment it is set without a fresh proof.
 */
export function issueSession(input: IssueSessionInput, policy: SessionPolicy): SessionRecord {
  return {
    sessionId: input.sessionId,
    ownerId: input.ownerId,
    deviceId: input.deviceId,
    authMethod: input.authMethod,
    issuedAt: input.now,
    lastSeenAt: input.now,
    expiresAt: inactivityDeadline(input.now, policy),
    recentAuthAt: input.now,
    state: "active",
    revokedAt: null,
  };
}

export type SessionEvaluation =
  | { readonly usable: true; readonly session: SessionRecord }
  | { readonly usable: false; readonly reason: "revoked" | "expired" };

/**
 * Decides whether a session may authorize this request, and slides its window.
 *
 * Returns the *updated* session rather than mutating, so the caller decides
 * whether to persist the slide. That matters: a request that is about to be
 * refused for another reason should not extend the session's life.
 *
 * Revocation is checked before expiry, and both before the slide. A revoked
 * session that also happens to be within its window must report `revoked` —
 * the owner needs to see that their revocation took effect, not a generic
 * timeout.
 *
 * **Expiry is computed from `lastSeenAt` and the policy in force, not from the
 * stored `expiresAt`.** The requirement is about inactivity, so the answer must
 * follow the configured inactivity period. Reading the stored column instead
 * would mean an operator who shortens the window leaves every existing session
 * running on its old, longer deadline — the change would appear to have been
 * applied and would not have been. The column remains as the persisted
 * projection the owner's session list displays; this function is what decides.
 */
export function evaluateSession(
  session: SessionRecord,
  now: Date,
  policy: SessionPolicy,
): SessionEvaluation {
  if (session.state === "revoked") {
    return { usable: false, reason: "revoked" };
  }
  if (
    session.state === "expired" ||
    now.getTime() > inactivityDeadline(session.lastSeenAt, policy).getTime()
  ) {
    return { usable: false, reason: "expired" };
  }
  return {
    usable: true,
    session: {
      ...session,
      lastSeenAt: now,
      // The window slides from this activity, not from issuance.
      expiresAt: inactivityDeadline(now, policy),
    },
  };
}

/**
 * Whether authentication is recent enough for a sensitive operation.
 *
 * Exclusive at the far edge: exactly at the boundary the proof is still good.
 * A session cannot be made sensitive-capable by waiting, only by proving
 * possession again, so the tie goes to the shorter path for the owner.
 */
export function isRecentlyAuthenticated(
  recentAuthAt: Date,
  now: Date,
  policy: SessionPolicy,
): boolean {
  const age = now.getTime() - recentAuthAt.getTime();
  // A clock that moved backwards must not be read as "authenticated in the
  // future"; treat any negative age as not recent rather than trusting it.
  if (age < 0) {
    return false;
  }
  return age <= policy.recentAuthMinutes * 60_000;
}

/** Records a fresh proof of possession without touching the session window. */
export function refreshRecentAuthentication(session: SessionRecord, now: Date): SessionRecord {
  return { ...session, recentAuthAt: now };
}

/**
 * Revokes a session.
 *
 * Idempotent: revoking an already-revoked session keeps the original
 * `revokedAt`, because that is when the owner's decision took effect and it is
 * what the audit trail refers to.
 */
export function revokeSession(session: SessionRecord, now: Date): SessionRecord {
  if (session.state === "revoked") {
    return session;
  }
  return { ...session, state: "revoked", revokedAt: now };
}

/**
 * Whether a session may be renewed.
 *
 * Renewal is not a separate power from use: anything that cannot authorize a
 * request cannot extend itself either. Stating it as its own function keeps a
 * future renewal endpoint from growing its own, laxer, rule.
 */
export function canRenew(session: SessionRecord, now: Date, policy: SessionPolicy): boolean {
  return evaluateSession(session, now, policy).usable;
}
