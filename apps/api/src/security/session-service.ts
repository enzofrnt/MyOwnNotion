/**
 * Owner authentication and session orchestration (T044, feature 002).
 *
 * The one place that turns a proof of possession into a session, and a cookie
 * back into a principal. Everything it enforces is enforced here rather than
 * in the routes, so a new route cannot get a laxer version by accident.
 *
 * The rules that shape the module:
 *
 *   - **Every credential failure is the same failure.** Wrong password, no
 *     password set, unknown credential, revoked device — all produce
 *     `authentication_failed` after the same work. Any difference in code,
 *     message, or timing turns the endpoint into an oracle that answers
 *     questions an attacker would otherwise have to guess at.
 *   - **The session secret exists in exactly two places**: the response cookie
 *     and the caller's browser. The database holds a digest. A table dump must
 *     not yield a usable session.
 *   - **Passkey remains sufficient on its own.** Setting a password adds an
 *     alternative; it never becomes a second required factor, and it never
 *     disables the passkey path.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createSession,
  type Database,
  findDevice,
  listSessions,
  type RevocationResult,
  resolveSession,
  revokeAllSessions,
  revokeOneSession,
  SecurityRepositoryError,
} from "@myownnotion/database";
import {
  issueSession,
  type SessionAuthMethod,
  type SessionPolicy,
  type SessionRecord,
} from "@myownnotion/domain";
import type { AuditService } from "./audit-service.ts";
import { consumeRateLimit } from "./rate-limit-service.ts";

/**
 * The single failure every rejected authentication produces.
 *
 * One class, one code, no detail. A subclass per reason would be convenient
 * for logging and would sooner or later be rendered into a response.
 */
export class AuthenticationFailedError extends SecurityRepositoryError {
  constructor() {
    super("authentication_failed", "authentication failed");
    this.name = "AuthenticationFailedError";
  }
}

export class SessionRateLimitedError extends SecurityRepositoryError {
  constructor(readonly retryAfter: Date | undefined) {
    super("rate_limited", "too many authentication attempts");
    this.name = "SessionRateLimitedError";
  }
}

/** Digests the opaque session secret. Never reversible, never logged. */
export function digestSessionSecret(secret: string): string {
  return createHash("sha256").update(`session|${secret}`).digest("base64url");
}

/** 32 bytes of randomness, base64url. The only copy the browser gets. */
function newSessionSecret(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionServiceDeps {
  readonly db: Database;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly policy: SessionPolicy;
  readonly now: () => Date;
}

export interface IssuedSession {
  readonly session: SessionRecord;
  /** Returned once, into the cookie. Never persisted in the clear. */
  readonly secret: string;
}

export type SessionResolution =
  | { readonly resolved: true; readonly session: SessionRecord }
  | { readonly resolved: false; readonly reason: "absent" | "rejected" };

export class SessionService {
  readonly #deps: SessionServiceDeps;

  constructor(deps: SessionServiceDeps) {
    this.#deps = deps;
  }

  #auditContext(correlationId: string) {
    return {
      installationId: this.#deps.installationId,
      correlationId,
      actorClass: "owner" as const,
    };
  }

  /**
   * Consumes the authentication budget for a subject.
   *
   * Applied before the credential is examined, so a wrong guess and a right
   * one cost the same number of attempts. Charging only failures would let an
   * attacker distinguish them by watching the budget.
   */
  async #rateLimit(subject: string): Promise<void> {
    const decision = await consumeRateLimit(this.#deps.db, {
      installationId: this.#deps.installationId,
      operation: "auth.login",
      subject,
      now: this.#deps.now(),
    });
    if (!decision.allowed) {
      throw new SessionRateLimitedError(decision.retryAfter);
    }
  }

  /**
   * Issues a session after a successful proof of possession.
   *
   * Callers reach this only after verifying a credential; the method itself
   * verifies nothing, which is why it is not exported beyond the service.
   */
  async issue(input: {
    ownerId: string;
    deviceId: string;
    authMethod: SessionAuthMethod;
    correlationId: string;
  }): Promise<IssuedSession> {
    const now = this.#deps.now();
    const secret = newSessionSecret();
    const session = issueSession(
      {
        sessionId: randomUUID(),
        ownerId: input.ownerId,
        deviceId: input.deviceId,
        authMethod: input.authMethod,
        now,
      },
      this.#deps.policy,
    );

    await this.#deps.db.transaction(async (tx) => {
      await createSession(tx, { session, sessionSecretHash: digestSessionSecret(secret) });
      // Two events, not one: `auth.succeeded` is about the credential, and
      // `session.issued` is about what it bought. An operator reviewing a
      // compromise needs to see a proof that produced no session, and a
      // session that appeared without one, as different things.
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "auth.succeeded",
        outcome: "success",
      });
      await this.#deps.audit.recordInTransaction(tx, this.#auditContext(input.correlationId), {
        eventType: "session.issued",
        outcome: "success",
        objectKind: "session",
        objectId: session.sessionId,
      });
    });

    return { session, secret };
  }

  /**
   * Resolves the session a request presents.
   *
   * `absent` and `rejected` are kept apart here and only here: a route may
   * legitimately serve an anonymous caller, but must never serve one whose
   * session was rejected. Collapsing them would let a caller with a revoked
   * session be treated as anonymous and reach an anonymous-allowed route,
   * which is a quieter failure than being refused.
   */
  async resolve(secret: string | null): Promise<SessionResolution> {
    if (secret === null) {
      return { resolved: false, reason: "absent" };
    }
    const outcome = await resolveSession(this.#deps.db, {
      sessionSecretHash: digestSessionSecret(secret),
      now: this.#deps.now(),
      policy: this.#deps.policy,
    });
    if ("refused" in outcome) {
      // Unknown, revoked, and expired are one answer to the caller. The
      // distinction is in the server log, where it helps an operator, not in
      // the response, where it would help an attacker.
      return { resolved: false, reason: "rejected" };
    }
    // A live cookie cannot outlive the authorization of its device.
    // Check here so ordinary HTTP reads obey the same revocation as sync.
    const device = await findDevice(this.#deps.db, {
      ownerId: outcome.session.ownerId,
      deviceId: outcome.session.deviceId,
    });
    if (device === null || device.state === "revoked")
      return { resolved: false, reason: "rejected" };
    return { resolved: true, session: outcome.session };
  }

  async list(ownerId: string): Promise<readonly SessionRecord[]> {
    return await listSessions(this.#deps.db, ownerId);
  }

  async revokeOne(input: {
    ownerId: string;
    sessionId: string;
    correlationId: string;
  }): Promise<RevocationResult> {
    const result = await revokeOneSession(this.#deps.db, {
      ownerId: input.ownerId,
      sessionId: input.sessionId,
      now: this.#deps.now(),
    });
    await this.#deps.audit.record(this.#auditContext(input.correlationId), {
      eventType: "session.revoked",
      outcome: "success",
      objectKind: "session",
      objectId: input.sessionId,
    });
    return result;
  }

  /**
   * Revokes every session, optionally sparing the caller's own.
   *
   * Audited even when it revokes nothing. "The owner asked to sign out
   * everywhere and there was nothing to sign out" is a fact worth having in
   * the log — it is what an owner sees after a compromise scare, and its
   * absence would look like the request never arrived.
   */
  async revokeAll(input: {
    ownerId: string;
    exceptSessionId?: string;
    correlationId: string;
  }): Promise<RevocationResult> {
    const result = await revokeAllSessions(this.#deps.db, {
      ownerId: input.ownerId,
      now: this.#deps.now(),
      ...(input.exceptSessionId === undefined ? {} : { exceptSessionId: input.exceptSessionId }),
    });
    await this.#deps.audit.record(this.#auditContext(input.correlationId), {
      eventType: "session.revoked-all",
      outcome: "success",
    });
    return result;
  }

  /** Charges the login budget. Exposed so route handlers cannot forget it. */
  async chargeLoginAttempt(subject: string): Promise<void> {
    await this.#rateLimit(subject);
  }

  /**
   * Records a failed authentication.
   *
   * Best-effort by design: a failure to write the audit row must not turn a
   * refused login into a server error, because that difference would itself
   * tell the caller something.
   *
   * One event type for both methods. Which credential was tried is not
   * recorded, because the audit trail is readable by the owner and a log that
   * distinguishes "wrong password" from "unknown passkey" reintroduces, in
   * writing, exactly the oracle the responses avoid.
   */
  async recordFailure(correlationId: string): Promise<void> {
    await this.#deps.audit.record(this.#auditContext(correlationId), {
      eventType: "auth.failed",
      outcome: "failure",
      safeCode: "authentication_failed",
    });
  }
}
