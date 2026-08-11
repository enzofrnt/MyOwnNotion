/**
 * Session persistence and revocation (T040, feature 002).
 *
 * The contract suite drives these through HTTP; this one goes at the
 * repository directly, because two properties are only observable here:
 * concurrency, and what the stored row looks like afterwards.
 *
 * The question each test answers is "what happens to the row", not "what does
 * the route return" — a revocation that reports success while leaving an
 * active row is the failure worth catching, and no response body would show
 * it.
 */

import { randomUUID } from "node:crypto";
import {
  createInstallation,
  createSession,
  findSessionById,
  listSessions,
  recordRecentAuthentication,
  resolveSession,
  revokeAllSessions,
  revokeOneSession,
} from "@myownnotion/database";
import { issueSession, sessionPolicy } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  runConcurrently,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000cc";
const ORIGIN = new Date("2026-06-01T00:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const MINUTE = 60_000;
const policy = sessionPolicy();

function at(offsetMs: number): Date {
  return new Date(ORIGIN.getTime() + offsetMs);
}

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
  await context.handle.db.execute(sql`
    TRUNCATE sessions, authorized_devices, owners, installations CASCADE
  `);
  await createInstallation(context.handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await context.handle.db.execute(sql`
    INSERT INTO owners (id, installation_id, state)
    VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
  `);
  await context.handle.db.execute(sql`
    INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
    VALUES (${DEVICE_ID}::uuid, ${OWNER_ID}::uuid, 'binding', 'Laptop', 'active')
  `);
});

/** Issues a session and returns it with the digest the caller would present. */
async function issue(
  now = ORIGIN,
  method: "passkey" | "password" = "passkey",
): Promise<{ sessionId: string; hash: string }> {
  const session = issueSession(
    { sessionId: randomUUID(), ownerId: OWNER_ID, deviceId: DEVICE_ID, authMethod: method, now },
    policy,
  );
  const hash = `hash-${session.sessionId}`;
  await context.handle.db.transaction(async (tx) => {
    await createSession(tx, { session, sessionSecretHash: hash });
  });
  return { sessionId: session.sessionId, hash };
}

describe("resolving a session", () => {
  it("finds it by the digest, and slides its window", async () => {
    const { sessionId, hash } = await issue();
    const resolved = await resolveSession(context.handle.db, {
      sessionSecretHash: hash,
      now: at(DAY),
      policy,
    });
    expect("session" in resolved).toBe(true);

    const stored = await findSessionById(context.handle.db, sessionId);
    expect(stored?.lastSeenAt.getTime()).toBe(at(DAY).getTime());
    expect(stored?.expiresAt.getTime()).toBe(at(DAY + 30 * DAY).getTime());
  });

  it("refuses a digest it has never seen", async () => {
    await issue();
    const resolved = await resolveSession(context.handle.db, {
      sessionSecretHash: "not-a-real-digest",
      now: ORIGIN,
      policy,
    });
    expect(resolved).toEqual({ refused: "unknown" });
  });

  it("refuses a revoked session and says so", async () => {
    // The reason is kept apart here, inside the repository, so the server log
    // can distinguish a revocation taking effect from an ordinary timeout. The
    // caller collapses both into one answer.
    const { sessionId, hash } = await issue();
    await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) });
    expect(
      await resolveSession(context.handle.db, {
        sessionSecretHash: hash,
        now: at(2 * MINUTE),
        policy,
      }),
    ).toEqual({ refused: "revoked" });
  });

  it("refuses a lapsed session and records that it lapsed", async () => {
    // Marking the row means the inventory stops calling it active, and a later
    // read does not have to recompute the same verdict.
    const { sessionId, hash } = await issue();
    expect(
      await resolveSession(context.handle.db, {
        sessionSecretHash: hash,
        now: at(31 * DAY),
        policy,
      }),
    ).toEqual({ refused: "expired" });
    expect((await findSessionById(context.handle.db, sessionId))?.state).toBe("expired");
  });

  it("does not slide the window of a session it refused", async () => {
    // A refused request must not extend the life of the thing it was refused
    // for; otherwise a revoked session's row keeps looking recently used.
    const { sessionId, hash } = await issue();
    await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) });
    await resolveSession(context.handle.db, {
      sessionSecretHash: hash,
      now: at(10 * DAY),
      policy,
    });
    expect((await findSessionById(context.handle.db, sessionId))?.lastSeenAt.getTime()).toBe(
      ORIGIN.getTime(),
    );
  });
});

describe("recent authentication", () => {
  it("moves only the proof, not the window", async () => {
    const { sessionId } = await issue();
    await recordRecentAuthentication(context.handle.db, sessionId, at(5 * MINUTE));
    const stored = await findSessionById(context.handle.db, sessionId);
    expect(stored?.recentAuthAt.getTime()).toBe(at(5 * MINUTE).getTime());
    expect(stored?.expiresAt.getTime()).toBe(at(30 * DAY).getTime());
  });

  it("refuses to record against a revoked session", async () => {
    // Silently doing nothing would let a sensitive operation proceed believing
    // possession had just been proved.
    const { sessionId } = await issue();
    await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) });
    await expect(
      recordRecentAuthentication(context.handle.db, sessionId, at(2 * MINUTE)),
    ).rejects.toMatchObject({ code: "authentication_required" });
  });
});

describe("revoking one session", () => {
  it("writes the state rather than deleting the row", async () => {
    // The row is the record of a decision the owner made, and the audit trail
    // refers to it. Deleting would make "revoked" and "never existed"
    // indistinguishable afterwards.
    const { sessionId } = await issue();
    await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) });
    const stored = await findSessionById(context.handle.db, sessionId);
    expect(stored).not.toBeNull();
    expect(stored?.state).toBe("revoked");
    expect(stored?.revokedAt?.getTime()).toBe(at(MINUTE).getTime());
  });

  it("is idempotent", async () => {
    const { sessionId } = await issue();
    expect(
      await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) }),
    ).toEqual({ revokedCount: 1 });
    expect(
      await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(DAY) }),
    ).toEqual({ revokedCount: 0 });
    // The instant the decision took effect does not move.
    expect((await findSessionById(context.handle.db, sessionId))?.revokedAt?.getTime()).toBe(
      at(MINUTE).getTime(),
    );
  });

  it("refuses to revoke another owner's session", async () => {
    const { sessionId } = await issue();
    const result = await revokeOneSession(context.handle.db, {
      ownerId: "018f2b7c-0000-7000-8000-00000000dead",
      sessionId,
      now: at(MINUTE),
    });
    expect(result).toEqual({ revokedCount: 0 });
    expect((await findSessionById(context.handle.db, sessionId))?.state).toBe("active");
  });

  it("counts a concurrent double revocation exactly once", async () => {
    // Two clicks, or two tabs. Both must succeed as far as the owner is
    // concerned, and exactly one must be the revocation.
    const { sessionId } = await issue();
    const settled = await runConcurrently(
      context.postgres.connectionString,
      Array.from(
        { length: 4 },
        () => async (handle) =>
          revokeOneSession(handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) }),
      ),
    );
    const counted = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.revokedCount] : [],
    );
    // Exactly one revocation. Callers that serialized out are fine; what must
    // not happen is two of them each believing they revoked the session.
    expect(counted.filter((count) => count === 1)).toHaveLength(1);
  });
});

describe("revoking every session", () => {
  it("spares the one that asked", async () => {
    const keep = await issue();
    const drop = await issue();
    const result = await revokeAllSessions(context.handle.db, {
      ownerId: OWNER_ID,
      now: at(MINUTE),
      exceptSessionId: keep.sessionId,
    });
    expect(result).toEqual({ revokedCount: 1 });
    expect((await findSessionById(context.handle.db, keep.sessionId))?.state).toBe("active");
    expect((await findSessionById(context.handle.db, drop.sessionId))?.state).toBe("revoked");
  });

  it("takes everything when nothing is spared", async () => {
    // After a suspected compromise this is what the owner wants, including the
    // browser they are using.
    await issue();
    await issue();
    expect(
      await revokeAllSessions(context.handle.db, { ownerId: OWNER_ID, now: at(MINUTE) }),
    ).toEqual({ revokedCount: 2 });
  });

  it("reports zero rather than failing when there is nothing to revoke", async () => {
    expect(
      await revokeAllSessions(context.handle.db, { ownerId: OWNER_ID, now: at(MINUTE) }),
    ).toEqual({ revokedCount: 0 });
  });

  it("leaves already-revoked sessions where they were", async () => {
    const { sessionId } = await issue();
    await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) });
    await revokeAllSessions(context.handle.db, { ownerId: OWNER_ID, now: at(DAY) });
    expect((await findSessionById(context.handle.db, sessionId))?.revokedAt?.getTime()).toBe(
      at(MINUTE).getTime(),
    );
  });
});

describe("the inventory", () => {
  it("returns the owner's sessions, newest activity first", async () => {
    const older = await issue(ORIGIN);
    const newer = await issue(at(MINUTE));
    const listed = await listSessions(context.handle.db, OWNER_ID);
    expect(listed.map((session) => session.sessionId)).toEqual([newer.sessionId, older.sessionId]);
  });

  it("includes revoked and expired sessions", async () => {
    // The owner reviewing this list needs to see that a revocation took
    // effect, not find the row silently gone.
    const { sessionId } = await issue();
    await revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) });
    const listed = await listSessions(context.handle.db, OWNER_ID);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.state).toBe("revoked");
  });

  it("carries no secret digest", async () => {
    // The inventory is rendered in a browser. A field that never leaves the
    // repository cannot leak from a view.
    await issue();
    const listed = await listSessions(context.handle.db, OWNER_ID);
    expect(JSON.stringify(listed)).not.toContain("hash-");
  });
});

describe("concurrent sign-ins", () => {
  it("keeps every session distinct", async () => {
    // Two browsers signing in at once must not collide on the unique digest
    // index or overwrite each other's row.
    const sessions = await Promise.all([issue(ORIGIN), issue(ORIGIN), issue(ORIGIN)]);
    const ids = new Set(sessions.map((session) => session.sessionId));
    expect(ids.size).toBe(3);
    expect(await listSessions(context.handle.db, OWNER_ID)).toHaveLength(3);
  });
});

describe("concurrent requests on one session", () => {
  it("all succeed", async () => {
    // Every screen makes several authenticated requests at once. An earlier
    // version resolved the session inside a serializable transaction that does
    // not retry, so two of them would serialize against each other and one
    // came back as a server error — the security screen appeared with "the
    // session list could not be loaded" for no reason the owner could act on.
    const { hash } = await issue();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        resolveSession(context.handle.db, {
          sessionSecretHash: hash,
          now: at(MINUTE),
          policy,
        }),
      ),
    );
    expect(outcomes.every((outcome) => "session" in outcome)).toBe(true);
  });

  it("a revocation landing mid-flight is never overwritten", async () => {
    // The property the transaction used to provide, kept by the `WHERE`
    // clause instead: a request already in flight must not write a fresh
    // window over a session the owner has just revoked.
    const { sessionId, hash } = await issue();
    await Promise.all([
      revokeOneSession(context.handle.db, { ownerId: OWNER_ID, sessionId, now: at(MINUTE) }),
      ...Array.from({ length: 6 }, () =>
        resolveSession(context.handle.db, {
          sessionSecretHash: hash,
          now: at(MINUTE),
          policy,
        }),
      ),
    ]);
    const stored = await findSessionById(context.handle.db, sessionId);
    expect(stored?.state).toBe("revoked");
    // And it stays refused from then on.
    expect(
      await resolveSession(context.handle.db, {
        sessionSecretHash: hash,
        now: at(2 * MINUTE),
        policy,
      }),
    ).toEqual({ refused: "revoked" });
  });
});
