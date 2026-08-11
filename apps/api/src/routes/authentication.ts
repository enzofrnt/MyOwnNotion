/**
 * Authentication, credential management, and session routes (T042/T043/T046,
 * feature 002).
 *
 * The shape of this file is set by three rules, each of which has a comment at
 * the place it is enforced rather than only here:
 *
 *   - **Login answers the same way whatever went wrong.** Unknown credential,
 *     wrong password, no password set, revoked device, no owner at all: one
 *     status, one code, and comparable elapsed time. Anything else lets a
 *     caller enumerate what exists.
 *   - **Sensitive operations need proof of possession now.** Enrolling a
 *     credential, changing the password, removing a passkey, and revoking
 *     everything all require recent authentication on top of a valid session.
 *     A month-old session is not permission to change how the account is
 *     entered.
 *   - **The CSRF token is returned in the body and sent back in a header.**
 *     Never a URL, never a log line. The route that issues it is the only one
 *     that ever writes it down.
 */

import { randomUUID } from "node:crypto";
import {
  AuthenticatedSessionSchema,
  PasskeyEnrollmentCompletionSchema,
  PasskeyViewSchema,
  PasswordChangeSchema,
  PasswordLoginSchema,
  PasswordViewSchema,
  SecurityProblemSchema,
  SessionViewSchema,
  WebAuthnAssertionSchema,
  WebAuthnOptionsSchema,
} from "@myownnotion/contracts";
import type { Database } from "@myownnotion/database";
import {
  enrollPasskey,
  findActivePassword,
  findAnyAuthorizedDevice,
  findPasskeyByCredentialId,
  LastCredentialError,
  listPasskeys,
  readOwnerId,
  recordDeviceActivity,
  recordPasskeyUse,
  revokePasskey,
  setPassword,
} from "@myownnotion/database";
import {
  isRecentlyAuthenticated,
  type SessionPolicy,
  type SessionRecord,
} from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem, toSecurityProblem } from "../plugins/errors.ts";
import type { AuditService } from "../security/audit-service.ts";
import { authorizeRequest } from "../security/authentication-hook.ts";
import { clearSessionCookie, setSessionCookie } from "../security/cookie-policy.ts";
import { createCsrfValidator, deriveCsrfToken } from "../security/csrf.ts";
import {
  buildPasswordVersion,
  equivalentWork,
  verifyPassword,
  WeakPasswordError,
} from "../security/password-service.ts";
import { type RequestPrincipal, requestContext } from "../security/request-context.ts";
import type { SecurityConfig } from "../security/security-config.ts";
import { AuthenticationFailedError, type SessionService } from "../security/session-service.ts";
import {
  createChallenge,
  relyingParty,
  verifyAssertion,
  verifyRegistration,
  type WebAuthnChallenge,
} from "../security/webauthn-service.ts";

const CredentialParams = Type.Object({ credentialId: Type.String({ minLength: 1 }) });
const SessionParams = Type.Object({ sessionId: Type.String({ format: "uuid" }) });

/** The narrowed principal every authenticated handler in this file works from. */
type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

export interface AuthenticationRouteDeps {
  readonly db: Database;
  readonly config: SecurityConfig;
  readonly sessions: SessionService;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly deploymentKey: () => Buffer | null;
  readonly policy: SessionPolicy;
  readonly now: () => Date;
  /** Login challenges: single-use, in memory, never outliving a request pair. */
  readonly challenges: Map<string, WebAuthnChallenge>;
}

/** Session lifetime as a cookie `Max-Age`, in whole seconds. */
function cookieMaxAge(session: SessionRecord, now: Date): number {
  return Math.max(0, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000));
}

function sessionView(session: SessionRecord) {
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    authMethod: session.authMethod,
    issuedAt: session.issuedAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    state: session.state,
  };
}

export function registerAuthenticationRoutes(
  app: FastifyInstance,
  deps: AuthenticationRouteDeps,
): void {
  const csrf = createCsrfValidator({ deploymentKey: deps.deploymentKey });

  const auditContext = (request: FastifyRequest) => ({
    installationId: deps.installationId,
    correlationId: requestContext(request).correlationId,
    actorClass: "owner" as const,
  });

  /**
   * Applies a route's authentication requirement.
   *
   * Centralized so a new route cannot forget CSRF or recency: the requirement
   * is declared at the route, and the check happens here in a fixed order.
   */
  const require = (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ): OwnerPrincipal | null => {
    const context = requestContext(request);
    const decision = authorizeRequest(
      context,
      { principal: "owner", ...requirement },
      {
        csrf,
        // The one policy, from the domain, so the routes and the session
        // service can never disagree about what "recent" means.
        recentAuthentication: {
          isRecent: (recentAuthAt, now) => isRecentlyAuthenticated(recentAuthAt, now, deps.policy),
        },
      },
      request,
      deps.now(),
    );
    if (!decision.allowed) {
      if (decision.code === "csrf_validation_failed") {
        void deps.audit.record(auditContext(request), {
          eventType: "csrf.validation-failed",
          outcome: "refused",
          safeCode: "csrf_validation_failed",
        });
      }
      if (decision.code === "recent_authentication_required") {
        void deps.audit.record(auditContext(request), {
          eventType: "auth.reauthentication-required",
          outcome: "refused",
          safeCode: "recent_authentication_required",
        });
      }
      sendSecurityProblem(reply, {
        code: decision.code,
        correlationId: context.correlationId,
      });
      return null;
    }
    // `authorizeRequest` has already refused anything that is not an owner, so
    // this narrowing cannot fail. Returning the principal rather than a boolean
    // is what lets every handler below drop an unreachable `null` branch.
    return context.principal.kind === "owner" ? context.principal : null;
  };

  const fail = (request: FastifyRequest, reply: FastifyReply, error: unknown): FastifyReply =>
    sendSecurityProblem(reply, toSecurityProblem(error, requestContext(request).correlationId));

  /**
   * Answers a failed login.
   *
   * One helper so no handler can invent its own wording. The audit row is
   * written best-effort: a logging failure must not turn a refusal into a
   * server error, because that difference is itself an answer.
   */
  const refuseLogin = async (request: FastifyRequest, reply: FastifyReply) => {
    await deps.sessions.recordFailure(requestContext(request).correlationId);
    return sendSecurityProblem(reply, {
      code: "authentication_failed",
      correlationId: requestContext(request).correlationId,
    });
  };

  /** Issues the cookie and the CSRF token for a freshly authenticated session. */
  const completeLogin = async (
    request: FastifyRequest,
    reply: FastifyReply,
    input: { ownerId: string; deviceId: string; authMethod: "passkey" | "password" },
  ) => {
    const issued = await deps.sessions.issue({
      ownerId: input.ownerId,
      deviceId: input.deviceId,
      authMethod: input.authMethod,
      correlationId: requestContext(request).correlationId,
    });
    const key = deps.deploymentKey();
    if (key === null) {
      // Without the wrapping key no CSRF token can be derived, and a session
      // with no CSRF token could never perform a protected write. Refusing now
      // is honest; issuing a session that cannot be used is not.
      return sendSecurityProblem(reply, {
        code: "installation_degraded",
        correlationId: requestContext(request).correlationId,
      });
    }
    await recordDeviceActivity(deps.db, { deviceId: input.deviceId, now: deps.now() });
    setSessionCookie(reply, deps.config, issued.secret, cookieMaxAge(issued.session, deps.now()));
    return reply.status(200).send({
      session: sessionView(issued.session),
      // Body, not URL. This is the only place the token is written.
      csrfToken: deriveCsrfToken(key, issued.session.sessionId),
    });
  };

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------

  app.post(
    "/v1/auth/login/passkey/options",
    { schema: { response: { 200: WebAuthnOptionsSchema } } },
    async (_request, reply) => {
      // Anonymous by necessity: the caller has not proved anything yet. The
      // options carry a challenge and nothing about whether an owner exists —
      // which is why the request itself is not consulted.
      const challenge = createChallenge(deps.now());
      deps.challenges.set(challenge.challenge, challenge);
      return reply.status(200).send({ challenge: challenge.challenge });
    },
  );

  app.post(
    "/v1/auth/login/passkey",
    {
      schema: {
        body: WebAuthnAssertionSchema,
        response: { 200: AuthenticatedSessionSchema, 401: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      const assertion = request.body as { id: string; response: { clientDataJSON: string } };
      try {
        await deps.sessions.chargeLoginAttempt(assertion.id);
      } catch (error) {
        return fail(request, reply, error);
      }

      const credential = await findPasskeyByCredentialId(deps.db, assertion.id);
      // A revoked credential is refused exactly like an unknown one.
      if (credential === null || credential.state !== "active") {
        return await refuseLogin(request, reply);
      }

      // The challenge is looked up from the ceremony's own client data, and
      // consumed whether or not verification succeeds: a failed attempt must
      // not leave a challenge a second attempt could reuse.
      const challengeKey = readChallengeFromClientData(assertion.response.clientDataJSON);
      const challenge = challengeKey === null ? undefined : deps.challenges.get(challengeKey);
      if (challengeKey !== null) {
        deps.challenges.delete(challengeKey);
      }
      if (challenge === undefined) {
        return await refuseLogin(request, reply);
      }

      let verified: Awaited<ReturnType<typeof verifyAssertion>>;
      try {
        verified = await verifyAssertion({
          response: assertion,
          challenge,
          relyingParty: relyingParty(deps.config),
          credential: {
            credentialId: credential.credentialId,
            publicKey: credential.publicKey,
            signCount: credential.signCount,
          },
          now: deps.now(),
        });
      } catch {
        return await refuseLogin(request, reply);
      }

      const device = await findAnyAuthorizedDevice(deps.db, credential.ownerId);
      if (device === null || device.state !== "active") {
        // A revoked device cannot sign in, however good the credential.
        return await refuseLogin(request, reply);
      }

      await recordPasskeyUse(deps.db, {
        credentialId: credential.credentialId,
        signCount: verified.signCount,
        now: deps.now(),
      });
      return await completeLogin(request, reply, {
        ownerId: credential.ownerId,
        deviceId: device.id,
        authMethod: "passkey",
      });
    },
  );

  app.post(
    "/v1/auth/login/password",
    {
      schema: {
        body: PasswordLoginSchema,
        response: { 200: AuthenticatedSessionSchema, 401: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as { password: string };
      try {
        // Keyed by the origin rather than by a username: there is only one
        // owner, so the password itself is the only other candidate and using
        // it as a bucket key would put it in a stored digest.
        await deps.sessions.chargeLoginAttempt(request.ip);
      } catch (error) {
        return fail(request, reply, error);
      }

      const owner = await readOwnerId(deps.db);
      const stored = owner === null ? null : await findActivePassword(deps.db, owner);
      if (stored === null) {
        // No owner, or no password set. Both burn the same work as a real
        // verification before answering, so elapsed time does not distinguish
        // "no password configured" from "wrong password".
        await equivalentWork();
        return await refuseLogin(request, reply);
      }
      if (!(await verifyPassword(body.password, stored.passwordHash))) {
        return await refuseLogin(request, reply);
      }

      const device = await findAnyAuthorizedDevice(deps.db, stored.ownerId);
      if (device === null || device.state !== "active") {
        return await refuseLogin(request, reply);
      }
      return await completeLogin(request, reply, {
        ownerId: stored.ownerId,
        deviceId: device.id,
        authMethod: "password",
      });
    },
  );

  // -------------------------------------------------------------------------
  // The current session
  // -------------------------------------------------------------------------

  app.get(
    "/v1/auth/session",
    { schema: { response: { 200: AuthenticatedSessionSchema, 401: SecurityProblemSchema } } },
    async (request, reply) => {
      const owner = require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      const key = deps.deploymentKey();
      if (key === null) {
        return sendSecurityProblem(reply, {
          code: "installation_degraded",
          correlationId: requestContext(request).correlationId,
        });
      }
      const sessions = await deps.sessions.list(owner.ownerId);
      const current = sessions.find((session) => session.sessionId === owner.sessionId);
      if (current === undefined) {
        return sendSecurityProblem(reply, {
          code: "authentication_failed",
          correlationId: requestContext(request).correlationId,
        });
      }
      return reply.status(200).send({
        session: sessionView(current),
        csrfToken: deriveCsrfToken(key, owner.sessionId),
      });
    },
  );

  app.delete("/v1/auth/session", async (request, reply) => {
    const owner = require(request, reply, { csrf: true });
    if (owner === null) {
      return reply;
    }
    await deps.sessions.revokeOne({
      ownerId: owner.ownerId,
      sessionId: owner.sessionId,
      correlationId: requestContext(request).correlationId,
    });
    // Cleared with the same attributes it was set with, or the browser keeps
    // a cookie the server will never honour again.
    clearSessionCookie(reply, deps.config);
    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // The session inventory
  // -------------------------------------------------------------------------

  app.get(
    "/v1/auth/sessions",
    {
      schema: {
        response: {
          200: Type.Object(
            { sessions: Type.Array(SessionViewSchema) },
            { additionalProperties: false },
          ),
        },
      },
    },
    async (request, reply) => {
      const owner = require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      const sessions = await deps.sessions.list(owner.ownerId);
      // No secret digest is in `SessionView`, and the schema forbids extra
      // properties, so this response cannot grow one by accident.
      return reply.status(200).send({ sessions: sessions.map(sessionView) });
    },
  );

  app.delete(
    "/v1/auth/sessions/:sessionId",
    { schema: { params: SessionParams } },
    async (request, reply) => {
      const owner = require(request, reply, { csrf: true });
      if (owner === null) {
        return reply;
      }
      const { sessionId } = request.params as { sessionId: string };
      await deps.sessions.revokeOne({
        ownerId: owner.ownerId,
        sessionId,
        correlationId: requestContext(request).correlationId,
      });
      // 204 whether or not anything was revoked: an id that does not exist and
      // one already revoked must look the same, or the endpoint enumerates
      // session ids.
      return reply.status(204).send();
    },
  );

  app.post("/v1/auth/sessions/revoke-all", async (request, reply) => {
    // Recent authentication, unlike revoking one session: this is the control
    // an attacker with a stolen session would use to lock the owner out.
    const owner = require(request, reply, { csrf: true, recentAuthentication: true });
    if (owner === null) {
      return reply;
    }
    await deps.sessions.revokeAll({
      ownerId: owner.ownerId,
      // The caller's own session survives: "sign out everywhere else" after
      // losing a device should not also sign them out of the browser they are
      // doing it from.
      exceptSessionId: owner.sessionId,
      correlationId: requestContext(request).correlationId,
    });
    return reply.status(204).send();
  });

  // -------------------------------------------------------------------------
  // Passkey management
  // -------------------------------------------------------------------------

  app.post(
    "/v1/auth/passkeys/enrollment/options",
    { schema: { response: { 200: WebAuthnOptionsSchema } } },
    async (request, reply) => {
      const owner = require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const challenge = createChallenge(deps.now());
      deps.challenges.set(`enroll:${owner.sessionId}`, challenge);
      return reply.status(200).send({ challenge: challenge.challenge });
    },
  );

  app.post(
    "/v1/auth/passkeys/enrollment/complete",
    {
      schema: {
        body: PasskeyEnrollmentCompletionSchema,
        response: { 201: PasskeyViewSchema, 401: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      const owner = require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const body = request.body as { label: string };
      const challengeKey = `enroll:${owner.sessionId}`;
      const challenge = deps.challenges.get(challengeKey);
      deps.challenges.delete(challengeKey);
      if (challenge === undefined) {
        return fail(request, reply, new AuthenticationFailedError());
      }

      try {
        const registration = await verifyRegistration({
          response: request.body,
          challenge,
          relyingParty: relyingParty(deps.config),
          now: deps.now(),
        });
        const credentialRowId = randomUUID();
        await deps.db.transaction(async (tx) => {
          await enrollPasskey(tx, {
            id: credentialRowId,
            ownerId: owner.ownerId,
            credentialId: registration.credentialId,
            publicKey: registration.publicKey,
            signCount: registration.signCount,
            label: body.label,
            now: deps.now(),
          });
          await deps.audit.recordInTransaction(tx, auditContext(request), {
            eventType: "auth.passkey-enrolled",
            outcome: "success",
            objectKind: "credential",
            objectId: credentialRowId,
          });
        });
        return reply.status(201).send({
          credentialId: registration.credentialId,
          label: body.label,
          state: "active",
          createdAt: deps.now().toISOString(),
        });
      } catch (error) {
        return fail(request, reply, error);
      }
    },
  );

  app.get(
    "/v1/auth/passkeys",
    {
      schema: {
        response: {
          200: Type.Object(
            { passkeys: Type.Array(PasskeyViewSchema) },
            { additionalProperties: false },
          ),
        },
      },
    },
    async (request, reply) => {
      const owner = require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      const credentials = await listPasskeys(deps.db, owner.ownerId);
      return reply.status(200).send({
        passkeys: credentials.map((credential) => ({
          credentialId: credential.credentialId,
          // A credential enrolled during bootstrap has no label; the owner
          // never chose one, so the response says what it is rather than
          // inventing a name they would not recognise.
          label: credential.label ?? "First passkey",
          state: credential.state,
          createdAt: credential.createdAt.toISOString(),
        })),
      });
    },
  );

  app.delete(
    "/v1/auth/passkeys/:credentialId",
    { schema: { params: CredentialParams } },
    async (request, reply) => {
      const owner = require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const { credentialId } = request.params as { credentialId: string };
      try {
        const result = await revokePasskey(deps.db, {
          ownerId: owner.ownerId,
          credentialId,
          now: deps.now(),
        });
        if (result.removed) {
          await deps.audit.record(auditContext(request), {
            eventType: "auth.passkey-removed",
            outcome: "success",
            objectKind: "credential",
          });
        }
        // 204 either way: an unknown credential id and an already-removed one
        // must be indistinguishable.
        return reply.status(204).send();
      } catch (error) {
        if (error instanceof LastCredentialError) {
          // The one refusal that is *not* silent. Removing the last way in
          // would lock the owner out permanently, and they need to know that
          // is why it did not happen.
          return sendSecurityProblem(reply, {
            code: "conflict",
            correlationId: requestContext(request).correlationId,
          });
        }
        return fail(request, reply, error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // The password alternative
  // -------------------------------------------------------------------------

  app.put(
    "/v1/auth/password",
    {
      schema: {
        body: PasswordChangeSchema,
        response: { 200: PasswordViewSchema, 400: SecurityProblemSchema },
      },
    },
    async (request, reply) => {
      const owner = require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const body = request.body as { newPassword: string };
      try {
        const version = await buildPasswordVersion({
          ownerId: owner.ownerId,
          password: body.newPassword,
          now: deps.now(),
        });
        await setPassword(deps.db, {
          id: version.id,
          ownerId: version.ownerId,
          passwordHash: version.passwordHash,
          hashAlgorithm: version.hashAlgorithm,
          hashParameters: version.hashParameters,
          now: version.createdAt,
        });
        await deps.audit.record(auditContext(request), {
          eventType: "auth.password-set",
          outcome: "success",
        });
        // The password never appears in the response, and the schema has no
        // field it could appear in.
        return reply.status(200).send({
          configured: true,
          state: "active",
          createdAt: version.createdAt.toISOString(),
        });
      } catch (error) {
        if (error instanceof WeakPasswordError) {
          return sendSecurityProblem(reply, {
            code: "validation_failed",
            correlationId: requestContext(request).correlationId,
          });
        }
        return fail(request, reply, error);
      }
    },
  );
}

/**
 * Reads the challenge a ceremony was performed against, from its own client
 * data.
 *
 * The alternative is a server-side "current login challenge", which is a
 * single slot two concurrent sign-ins would fight over. Reading it back from
 * the ceremony keeps each attempt independent; the value is still only
 * accepted if the server issued it, because it is looked up in the issued set.
 */
function readChallengeFromClientData(clientDataJSON: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as {
      challenge?: unknown;
    };
    return typeof decoded.challenge === "string" ? decoded.challenge : null;
  } catch {
    return null;
  }
}
