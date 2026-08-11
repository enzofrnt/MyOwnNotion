/**
 * Owner session persistence (T044, feature 002).
 *
 * Sessions are opaque and server-side: the browser holds a random secret, the
 * database holds only its digest, and every authority decision is made here
 * against a stored row. Nothing about the session's lifetime, owner, or device
 * travels in the cookie, so a stolen cookie cannot be edited into a longer or
 * broader session.
 *
 * Two rules the module keeps that are easy to lose:
 *
 *   - **Lookup is by digest, never by id.** The caller presents a secret; we
 *     hash it and look for that hash. Accepting an id would mean anyone who
 *     learned a session id — from a log, an inventory response, an error —
 *     could use it.
 *   - **Revocation is a write, not a delete.** A revoked session stays as a
 *     durable record of a decision the owner made, and the audit trail refers
 *     to it. Deleting would make "was this session revoked or did it never
 *     exist?" unanswerable.
 */

import {
  evaluateSession,
  type SessionAuthMethod,
  type SessionPolicy,
  type SessionRecord,
} from "@myownnotion/domain";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { sessions } from "../../schema/security/index.ts";
import { SecurityRepositoryError } from "./repository-types.ts";

type Executor = Database | Transaction;

type SessionRow = typeof sessions.$inferSelect;

function toSession(row: SessionRow): SessionRecord {
  return {
    sessionId: row.id,
    ownerId: row.ownerId,
    deviceId: row.deviceId,
    authMethod: row.authMethod as SessionAuthMethod,
    issuedAt: row.issuedAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    recentAuthAt: row.recentAuthAt,
    state: row.state as SessionRecord["state"],
    revokedAt: row.revokedAt,
  };
}

export interface CreateSessionInput {
  readonly session: SessionRecord;
  /** Digest of the opaque secret. The secret itself is never passed here. */
  readonly sessionSecretHash: string;
}

export async function createSession(tx: Transaction, input: CreateSessionInput): Promise<void> {
  const { session, sessionSecretHash } = input;
  await tx.insert(sessions).values({
    id: session.sessionId,
    ownerId: session.ownerId,
    deviceId: session.deviceId,
    sessionSecretHash,
    authMethod: session.authMethod,
    issuedAt: session.issuedAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    recentAuthAt: session.recentAuthAt,
    state: session.state,
    revokedAt: session.revokedAt,
  });
}

/**
 * Finds a session by the digest of the secret the caller presented.
 *
 * Returns `null` for "no such session", which the caller must treat exactly
 * like a revoked or expired one: distinguishing them would tell a caller
 * whether a given secret ever existed.
 */
export async function findSessionBySecretHash(
  executor: Executor,
  sessionSecretHash: string,
): Promise<SessionRecord | null> {
  const rows = await executor
    .select()
    .from(sessions)
    .where(eq(sessions.sessionSecretHash, sessionSecretHash))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toSession(row);
}

export async function findSessionById(
  executor: Executor,
  sessionId: string,
): Promise<SessionRecord | null> {
  const rows = await executor.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toSession(row);
}

/** Persists the slid window and, when it moved, the fresh proof of possession. */
export async function touchSession(executor: Executor, session: SessionRecord): Promise<void> {
  await executor
    .update(sessions)
    .set({
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      recentAuthAt: session.recentAuthAt,
    })
    .where(eq(sessions.id, session.sessionId));
}

/**
 * Resolves the session a request presents.
 *
 * **Deliberately not a serializable transaction.** An earlier version wrapped
 * the read and the slide in `runSecurityTransaction`, which does not retry —
 * so two authenticated requests from the same page, which every screen makes,
 * could serialize against each other and one would fail with a server error.
 * A session slide is a routine touch, not a claim whose conflict is the
 * answer; failing loudly there is wrong twice over.
 *
 * The property the transaction was protecting is kept by the `WHERE` clauses
 * instead. A revocation landing between the read and the write simply makes
 * the update match nothing, so a revoked session can never be resurrected by a
 * request that was already in flight. Two concurrent slides may overwrite each
 * other's `lastSeenAt`, and that is harmless: both are writing "now".
 */
export async function resolveSession(
  db: Database,
  input: { sessionSecretHash: string; now: Date; policy: SessionPolicy },
): Promise<{ session: SessionRecord } | { refused: "unknown" | "revoked" | "expired" }> {
  const stored = await findSessionBySecretHash(db, input.sessionSecretHash);
  if (stored === null) {
    return { refused: "unknown" as const };
  }
  const evaluated = evaluateSession(stored, input.now, input.policy);
  if (!evaluated.usable) {
    if (evaluated.reason === "expired" && stored.state !== "expired") {
      // Recorded so the row stops being reported as active in the inventory,
      // and so a later read does not have to recompute the same verdict. The
      // `state` guard keeps this from overwriting a revocation that landed
      // first: a revoked session must stay revoked, not become merely expired.
      await db
        .update(sessions)
        .set({ state: "expired" })
        .where(and(eq(sessions.id, stored.sessionId), eq(sessions.state, "active")));
    }
    return { refused: evaluated.reason };
  }
  await db
    .update(sessions)
    .set({
      lastSeenAt: evaluated.session.lastSeenAt,
      expiresAt: evaluated.session.expiresAt,
    })
    // The guard that replaces the transaction: a concurrent revocation makes
    // this match nothing rather than writing a fresh window over it.
    .where(and(eq(sessions.id, stored.sessionId), eq(sessions.state, "active")));
  return { session: evaluated.session };
}

/** Records a fresh proof of possession against an existing session. */
export async function recordRecentAuthentication(
  db: Database,
  sessionId: string,
  now: Date,
): Promise<void> {
  // One guarded statement, no transaction. See `resolveSession` for why these
  // are not serializable: their atomicity comes from the statement, and
  // wrapping them adds a failure mode without adding a guarantee.
  const updated = await db
    .update(sessions)
    .set({ recentAuthAt: now })
    .where(and(eq(sessions.id, sessionId), eq(sessions.state, "active")))
    .returning({ id: sessions.id });
  if (updated.length === 0) {
    // Refusing loudly: silently doing nothing would let a sensitive operation
    // proceed believing possession had just been proved.
    throw new SecurityRepositoryError(
      "authentication_required",
      "no active session to record authentication against",
    );
  }
}

export interface RevocationResult {
  readonly revokedCount: number;
}

/**
 * Revokes one session.
 *
 * Idempotent: revoking an already-revoked session is a success with a count of
 * zero, not an error. The owner asked for it to be gone, and it is.
 */
export async function revokeOneSession(
  db: Database,
  input: { ownerId: string; sessionId: string; now: Date },
): Promise<RevocationResult> {
  // A single guarded statement. Every condition that used to be a read
  // followed by a check is in the `WHERE`: the owner must match, so one
  // owner's id cannot revoke another's session and an id that never existed is
  // indistinguishable from one already revoked; and the state must be
  // `active`, so a second revocation reports zero and leaves the original
  // `revokedAt` — the instant the owner's decision took effect — untouched.
  //
  // Not a serializable transaction: the owner clicking "sign out" while the
  // page is making its ordinary requests must not lose a race and receive a
  // server error.
  const revoked = await db
    .update(sessions)
    .set({ state: "revoked", revokedAt: input.now })
    .where(
      and(
        eq(sessions.id, input.sessionId),
        eq(sessions.ownerId, input.ownerId),
        eq(sessions.state, "active"),
      ),
    )
    .returning({ id: sessions.id });
  return { revokedCount: revoked.length };
}

/**
 * Revokes every session, optionally sparing the one making the request.
 *
 * Sparing the current session is the default an owner wants: "sign out
 * everywhere else" after losing a device should not also sign them out of the
 * browser they are using to do it. Revoking everything including the current
 * session stays available, because after a suspected compromise that is
 * exactly what is wanted.
 */
export async function revokeAllSessions(
  db: Database,
  input: { ownerId: string; now: Date; exceptSessionId?: string },
): Promise<RevocationResult> {
  const scope =
    input.exceptSessionId === undefined
      ? and(eq(sessions.ownerId, input.ownerId), eq(sessions.state, "active"))
      : and(
          eq(sessions.ownerId, input.ownerId),
          eq(sessions.state, "active"),
          ne(sessions.id, input.exceptSessionId),
        );
  // Also a single statement: one `UPDATE` over the whole set is atomic on its
  // own, so there is nothing for a transaction to add here either.
  const revoked = await db
    .update(sessions)
    .set({ state: "revoked", revokedAt: input.now })
    .where(scope)
    .returning({ id: sessions.id });
  return { revokedCount: revoked.length };
}

/**
 * The owner-visible session inventory.
 *
 * Ordered newest-first by last activity: the owner scanning this list is
 * looking for something they do not recognise, and the most recent entries are
 * where a live intrusion would appear.
 *
 * No secret digest is selected. The inventory is rendered in a browser, and a
 * field that never leaves the repository cannot leak from a view.
 */
export async function listSessions(
  executor: Executor,
  ownerId: string,
): Promise<readonly SessionRecord[]> {
  const rows = await executor
    .select()
    .from(sessions)
    .where(eq(sessions.ownerId, ownerId))
    .orderBy(sql`${sessions.lastSeenAt} DESC`);
  return rows.map(toSession);
}
