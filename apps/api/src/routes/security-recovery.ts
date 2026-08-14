/**
 * Recovery-kit replacement over HTTP (T081, US5, FR-016, FR-018).
 *
 * Four routes, and the interesting decisions are about which of them demand
 * what.
 *
 * **Reading status asks for nothing.** It is how an owner finds out whether
 * they have a usable kit at all, and a re-authentication prompt in front of
 * that question would discourage the one check worth doing regularly.
 *
 * **Preparing, downloading, confirming and revoking all require recent
 * authentication.** Each either produces the material that recovers the whole
 * workspace or takes away the ability to recover it. An attacker holding a
 * stolen session must not be able to do either, and a kit download is exactly
 * what such an attacker would reach for.
 *
 * **The artifact is sent as a file, once.** `Content-Disposition: attachment`
 * and `Cache-Control: no-store`, because a recovery kit rendered inline is a
 * recovery kit in a browser's back button and in its disk cache.
 */

import { SecurityProblemSchema } from "@myownnotion/contracts";
import { isSafeProblemCode, type SafeProblemCode } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem } from "../plugins/errors.ts";
import type { AuditService } from "../security/audit-service.ts";
import { RecoveryKitError, type RecoveryKitService } from "../security/recovery-kit-service.ts";
import { type RequestPrincipal, requestContext } from "../security/request-context.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

export interface RecoveryRouteDeps {
  readonly kits: RecoveryKitService;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly require: (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ) => OwnerPrincipal | null;
}

const KitStatusSchema = Type.Object(
  {
    active: Type.Union([
      Type.Object(
        {
          kitId: Type.String(),
          recoveryEpoch: Type.Integer({ minimum: 1 }),
          confirmedAt: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    pending: Type.Union([
      Type.Object(
        {
          kitId: Type.String(),
          deliveryState: Type.String(),
          downloadExpiresAt: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    /**
     * What the owner must also keep. Part of the response body rather than
     * documentation, so no client can render this screen without it.
     */
    notice: Type.String(),
  },
  { additionalProperties: false },
);

const PreparedKitSchema = Type.Object(
  {
    kitId: Type.String(),
    recoveryEpoch: Type.Integer({ minimum: 1 }),
    downloadExpiresAt: Type.String(),
    notice: Type.String(),
  },
  { additionalProperties: false },
);

const ConfirmedKitSchema = Type.Object(
  { recoveryEpoch: Type.Integer({ minimum: 1 }), notice: Type.String() },
  { additionalProperties: false },
);

const RevokedKitSchema = Type.Object(
  { revocationCode: Type.String() },
  { additionalProperties: false },
);

export function registerRecoveryRoutes(app: FastifyInstance, deps: RecoveryRouteDeps): void {
  const auditContext = (request: FastifyRequest) => ({
    installationId: deps.installationId,
    correlationId: requestContext(request).correlationId,
    actorClass: "owner" as const,
  });

  app.get(
    "/v1/security/recovery",
    { schema: { response: { 200: KitStatusSchema, 401: SecurityProblemSchema } } },
    async (request, reply) => {
      // No recency requirement: this is the check an owner should be able to
      // make casually, and it reveals no material.
      const owner = deps.require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      return reply.status(200).send(await deps.kits.status());
    },
  );

  app.post(
    "/v1/security/recovery",
    { schema: { response: { 201: PreparedKitSchema, 401: SecurityProblemSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const correlationId = requestContext(request).correlationId;
      try {
        const prepared = await deps.kits.prepareReplacement();
        await deps.audit.record(auditContext(request), {
          eventType: "recovery.kit-prepared",
          outcome: "success",
          objectKind: "recovery-kit",
          objectId: prepared.kitId,
          metadata: { recoveryEpoch: prepared.recoveryEpoch },
        });
        return reply.status(201).send(prepared);
      } catch (error) {
        return await refuse(reply, request, error, correlationId);
      }
    },
  );

  app.post(
    "/v1/security/recovery/:kitId/download",
    // No response schema for the success case: the artifact is a file, and a
    // serializer that validated it would have to know the kit format, which
    // would put a second definition of it in the HTTP layer.
    { schema: { response: { 200: Type.Any(), 401: SecurityProblemSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const { kitId } = request.params as { kitId: string };
      const correlationId = requestContext(request).correlationId;
      try {
        const artifact = await deps.kits.download(kitId);
        await deps.audit.record(auditContext(request), {
          eventType: "recovery.kit-download-consumed",
          outcome: "success",
          objectKind: "recovery-kit",
          objectId: kitId,
        });
        return (
          reply
            .status(200)
            .header("content-type", "application/json")
            // A file, not a page. Rendered inline it would sit in the back
            // button and the disk cache, which is the opposite of a one-time
            // download.
            .header("content-disposition", 'attachment; filename="myownnotion-recovery.json"')
            .header("cache-control", "no-store")
            .send(artifact)
        );
      } catch (error) {
        return await refuse(reply, request, error, correlationId);
      }
    },
  );

  app.post(
    "/v1/security/recovery/:kitId/confirm",
    { schema: { response: { 200: ConfirmedKitSchema, 401: SecurityProblemSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const { kitId } = request.params as { kitId: string };
      const correlationId = requestContext(request).correlationId;
      try {
        const confirmed = await deps.kits.confirm(kitId);
        await deps.audit.record(auditContext(request), {
          eventType: "recovery.kit-confirmed",
          outcome: "success",
          objectKind: "recovery-kit",
          objectId: kitId,
          metadata: { recoveryEpoch: confirmed.recoveryEpoch },
        });
        // Two events, because the epoch advancing is a separate fact about the
        // installation from a kit being stored, and an operator reading the
        // trail may be looking for either.
        await deps.audit.record(auditContext(request), {
          eventType: "recovery.epoch-advanced",
          outcome: "success",
          objectKind: "recovery-epoch",
          objectId: String(confirmed.recoveryEpoch),
        });
        return reply.status(200).send(confirmed);
      } catch (error) {
        return await refuse(reply, request, error, correlationId);
      }
    },
  );

  app.post(
    "/v1/security/recovery/revoke",
    { schema: { response: { 200: RevokedKitSchema, 401: SecurityProblemSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const correlationId = requestContext(request).correlationId;
      try {
        const revoked = await deps.kits.revoke();
        await deps.audit.record(auditContext(request), {
          eventType: "recovery.kit-revoked",
          outcome: "success",
          objectKind: "recovery-kit",
          // The code, not the kit id: it is what the owner is shown, and it is
          // what they will quote when they ask what happened.
          objectId: revoked.revocationCode,
        });
        return reply.status(200).send(revoked);
      } catch (error) {
        return await refuse(reply, request, error, correlationId);
      }
    },
  );

  /**
   * Turns a service refusal into a safe problem.
   *
   * The service's codes are already drawn from the allowlist, and anything
   * else collapses to `internal_error` on the way out — a message written for
   * an operator must never become a client-visible detail.
   */
  async function refuse(
    reply: FastifyReply,
    request: FastifyRequest,
    error: unknown,
    correlationId: string,
  ): Promise<FastifyReply> {
    // Only codes from the allowlist reach a client; anything else collapses
    // to `internal_error`, because a message written for an operator must not
    // become a client-visible detail.
    const code: SafeProblemCode =
      error instanceof RecoveryKitError && isSafeProblemCode(error.code)
        ? error.code
        : "internal_error";
    await deps.audit.record(auditContext(request), {
      eventType: "recovery.kit-rejected",
      outcome: "refused",
      objectKind: "recovery-kit",
    });
    return sendSecurityProblem(reply, { code, correlationId });
  }
}
