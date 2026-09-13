/**
 * Rotation status and explicit triggers (T085, US5, FR-025 – FR-027).
 *
 * Rotation is the one owner-facing operation that rewrites data and cannot be
 * undone, so the route is built to make starting one deliberate:
 *
 *   - **`confirmation` is required and never defaulted.** The contract has no
 *     default for it, and the handler refuses a false value rather than
 *     treating the request as consent. A client that forgets the field cannot
 *     start a rotation by accident;
 *   - **recent authentication is required**, like revoking a device. An
 *     attacker holding a stolen session should not be able to start an
 *     expensive rewrite, and an emergency rotation is exactly what they would
 *     reach for to keep an owner busy;
 *   - **`dryRun` answers what would happen without doing it.** An operator
 *     deciding whether to rotate at 2am deserves to see the size of the job
 *     first.
 *
 * Reading status needs none of that: it is how an owner finds out a rotation
 * is overdue, and putting a prompt in front of it would discourage looking.
 */

import { randomUUID } from "node:crypto";
import {
  RotationPolicyViewSchema,
  type RotationStartDto,
  RotationStartSchema,
  RotationViewSchema,
  SecurityProblemSchema,
} from "@myownnotion/contracts";
import {
  type Database,
  findLatestCheckpoint,
  findRotationOperation,
  findRotationPolicy,
  findRunningRotation,
  type RotationKind,
  type RotationMode,
  RotationRepositoryError,
  startRotationOperation,
  type Transaction,
} from "@myownnotion/database";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendSecurityProblem } from "../plugins/errors.ts";
import type { AuditService } from "../security/audit-service.ts";
import { type RequestPrincipal, requestContext } from "../security/request-context.ts";
import type { RotationHealth, RotationPolicyService } from "../security/rotation-policy-service.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

export interface RotationRouteDeps {
  readonly db: Database;
  readonly policies: RotationPolicyService;
  readonly audit: AuditService;
  readonly installationId: string;
  readonly now: () => Date;
  readonly require: (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ) => OwnerPrincipal | null;
}

const RotationStatusSchema = Type.Object(
  {
    policies: Type.Array(RotationPolicyViewSchema),
    writesAllowed: Type.Boolean(),
    running: Type.Array(RotationViewSchema),
  },
  { additionalProperties: false },
);

const RotationPoliciesSchema = Type.Object(
  { policies: Type.Array(RotationPolicyViewSchema, { minItems: 2, maxItems: 2 }) },
  { additionalProperties: false },
);
const RotationOperationParams = Type.Object({ operationId: Type.String({ format: "uuid" }) });
const problemResponses = {
  400: SecurityProblemSchema,
  401: SecurityProblemSchema,
  403: SecurityProblemSchema,
  404: SecurityProblemSchema,
  409: SecurityProblemSchema,
  428: SecurityProblemSchema,
  500: SecurityProblemSchema,
  503: SecurityProblemSchema,
} as const;

type RotationOperation = NonNullable<Awaited<ReturnType<typeof findRotationOperation>>>;

function operationView(operation: RotationOperation, checkpointDigest: string | null) {
  return {
    operationId: operation.id,
    kind: operation.kind,
    mode: operation.mode,
    phase: operation.phase,
    fromVersionOrGeneration: operation.fromVersionOrGeneration,
    toVersionOrGeneration: operation.toVersionOrGeneration,
    processedCount: operation.processedCount,
    totalCount: operation.totalCount,
    checkpointDigest,
    failureCode: operation.failureCode,
  };
}

function toPolicyViews(health: RotationHealth) {
  return (
    [
      ["wrapping-key", health.wrappingKey],
      ["data-key", health.dataKey],
    ] as const
  )
    .filter(([, evaluation]) => evaluation !== null)
    .map(([kind, evaluation]) => ({
      kind,
      state: evaluation?.state ?? "pre-due",
      dueAt: (evaluation?.dueAt ?? new Date()).toISOString(),
      writeBlockAt: (evaluation?.writeBlockAt ?? new Date()).toISOString(),
      lastCompletedAt: evaluation?.lastCompletedAt?.toISOString() ?? null,
      currentVersionOrGeneration: evaluation?.currentGeneration ?? 1,
      nextAction: evaluation?.nextAction ?? "none",
    }));
}

export function registerRotationRoutes(app: FastifyInstance, deps: RotationRouteDeps): void {
  const auditContext = (request: FastifyRequest) => ({
    installationId: deps.installationId,
    correlationId: requestContext(request).correlationId,
    actorClass: "owner" as const,
  });

  app.get(
    "/v1/security/rotations",
    { schema: { response: { 200: RotationStatusSchema, ...problemResponses } } },
    async (request, reply) => {
      reply.header("cache-control", "private, no-store");
      // No recency requirement: this is how an owner discovers a rotation is
      // overdue, and a prompt in front of it would discourage looking.
      const owner = deps.require(request, reply, {});
      if (owner === null) {
        return reply;
      }
      const health = await deps.policies.health();
      const running = [];
      for (const kind of ["wrapping-key", "data-key"] as const) {
        const operation = await findRunningRotation(deps.db, {
          installationId: deps.installationId,
          kind,
        });
        if (operation !== null) {
          running.push({
            operationId: operation.id,
            kind: operation.kind,
            mode: operation.mode,
            phase: operation.phase,
            fromVersionOrGeneration: operation.fromVersionOrGeneration,
            toVersionOrGeneration: operation.toVersionOrGeneration,
            processedCount: operation.processedCount,
            totalCount: operation.totalCount,
          });
        }
      }
      return reply.status(200).send({
        policies: toPolicyViews(health),
        writesAllowed: health.writesAllowed,
        running,
      });
    },
  );

  app.post(
    "/v1/security/rotations",
    {
      schema: {
        body: RotationStartSchema,
        response: { 200: RotationViewSchema, 202: RotationViewSchema, ...problemResponses },
      },
    },
    async (request, reply) => {
      // Recent authentication, like revoking a device: an attacker holding a
      // stolen session must not be able to start an expensive rewrite, and an
      // emergency rotation is exactly what they would reach for.
      const owner = deps.require(request, reply, { csrf: true, recentAuthentication: true });
      if (owner === null) {
        return reply;
      }
      const body = request.body as RotationStartDto;
      const correlationId = requestContext(request).correlationId;

      if (!body.confirmation) {
        // Refused rather than defaulted. A rotation rewrites data; a client
        // that omitted the field did not consent to that.
        return sendSecurityProblem(reply, { code: "validation_failed", correlationId });
      }

      const kind = body.kind as RotationKind;
      const health = await deps.policies.health();
      const evaluation = kind === "wrapping-key" ? health.wrappingKey : health.dataKey;
      if (evaluation === null) {
        return sendSecurityProblem(reply, { code: "not_found", correlationId });
      }

      if (body.dryRun) {
        // Answers the shape of the job without starting it. Deliberately a
        // 200 with a `planned` phase and no operation row: nothing has begun,
        // and returning 202 would suggest otherwise.
        return reply.status(200).send({
          operationId: randomUUID(),
          kind,
          mode: body.mode,
          phase: "planned",
          fromVersionOrGeneration: evaluation.currentGeneration,
          toVersionOrGeneration: evaluation.currentGeneration + 1,
          processedCount: 0,
          totalCount: 0,
        });
      }

      try {
        const operation = await deps.db.transaction(async (tx) =>
          startRotationOperation(tx, {
            id: randomUUID(),
            installationId: deps.installationId,
            policyId: await policyIdFor(tx, deps.installationId, kind),
            kind,
            mode: body.mode as RotationMode,
            fromVersionOrGeneration: evaluation.currentGeneration,
            toVersionOrGeneration: evaluation.currentGeneration + 1,
            totalCount: 0,
            auditReason: body.reason,
          }),
        );
        await deps.audit.record(auditContext(request), {
          eventType: "rotation.started",
          outcome: "success",
          objectKind: "rotation",
          objectId: operation.id,
          metadata: { kind, mode: body.mode },
        });
        // 202: accepted and running, not finished. A rotation that returned
        // 200 would suggest the rewrite was already done.
        return reply.status(202).send(operationView(operation, null));
      } catch (error) {
        if (error instanceof RotationRepositoryError && error.code === "rotation_in_progress") {
          return sendSecurityProblem(reply, { code: "rotation_in_progress", correlationId });
        }
        if (error instanceof RotationRepositoryError && error.code === "policy_missing") {
          return sendSecurityProblem(reply, { code: "not_found", correlationId });
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/security/rotations/policies",
    { schema: { response: { 200: RotationPoliciesSchema, ...problemResponses } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, {});
      if (owner === null) return reply;
      const health = await deps.policies.health();
      if (health.wrappingKey === null || health.dataKey === null) {
        return sendSecurityProblem(reply, {
          code: "installation_degraded",
          correlationId: requestContext(request).correlationId,
        });
      }
      return reply.status(200).send({ policies: toPolicyViews(health) });
    },
  );

  app.get(
    "/v1/security/rotations/:operationId",
    {
      schema: {
        params: RotationOperationParams,
        response: { 200: RotationViewSchema, ...problemResponses },
      },
    },
    async (request, reply) => {
      const owner = deps.require(request, reply, {});
      if (owner === null) return reply;
      const { operationId } = request.params as { operationId: string };
      const operation = await findRotationOperation(deps.db, {
        installationId: deps.installationId,
        operationId,
      });
      if (operation === null) {
        return sendSecurityProblem(reply, {
          code: "not_found",
          correlationId: requestContext(request).correlationId,
        });
      }
      const checkpoint = await findLatestCheckpoint(deps.db, operation.id);
      return reply.status(200).send(operationView(operation, checkpoint?.checkpointDigest ?? null));
    },
  );
}

/** The policy row id for a kind, which `startRotationOperation` needs. */
async function policyIdFor(
  tx: Transaction,
  installationId: string,
  kind: RotationKind,
): Promise<string> {
  const record = await findRotationPolicy(tx, {
    installationId,
    kind,
  });
  if (record === null) {
    throw new RotationRepositoryError("policy_missing", `no ${kind} rotation policy exists`);
  }
  return record.id;
}
