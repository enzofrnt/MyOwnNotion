/**
 * What the owner can know about backups without opening one (T018, T033).
 *
 * This is an owner route, not an administrative route: it exposes safe status
 * already recorded in the workspace database and never a destination path,
 * credential, archive name, digest, or manifest. Destructive restoration stays
 * on the protected local CLI.
 */

import {
  type Database,
  lastTestRestoration,
  lastVerifiedBackupAtDestination,
  latestBackupVerificationStatus,
} from "@myownnotion/database";
import { backupIsStale, type Uuid } from "@myownnotion/domain";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CommandResult } from "../admin/command-output.ts";
import { sendSecurityProblem } from "../plugins/errors.ts";
import type { RequestPrincipal } from "../security/request-context.ts";
import { requestContext } from "../security/request-context.ts";

type OwnerPrincipal = Extract<RequestPrincipal, { kind: "owner" }>;

export interface BackupRouteDeps {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly now?: () => Date;
  /** Executes the same isolated restore as the local `restore test` command. */
  readonly runRehearsal?: (() => Promise<CommandResult>) | undefined;
  readonly require: (
    request: FastifyRequest,
    reply: FastifyReply,
    requirement: { csrf?: boolean; recentAuthentication?: boolean },
  ) => OwnerPrincipal | null;
}

export const BackupStatusSchema = Type.Object(
  {
    lastVerifiedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    lastVerifiedBackupId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    latestBackupAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    latestBackupId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
    latestCreationVerification: Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Null(),
    ]),
    latestTransferVerification: Type.Union([
      Type.Literal("passed"),
      Type.Literal("failed"),
      Type.Null(),
    ]),
    lastRehearsalAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
    lastRehearsalOutcome: Type.Union([
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Null(),
    ]),
    stale: Type.Boolean(),
    rehearsalDue: Type.Boolean(),
  },
  { additionalProperties: false },
);

const RehearsalResultSchema = Type.Object(
  {
    outcome: Type.Literal("succeeded"),
    restoredItemCount: Type.Integer({ minimum: 0 }),
    restoredFileCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const REHEARSAL_AFTER_DAYS = 31;

export function registerBackupRoutes(app: FastifyInstance, deps: BackupRouteDeps): void {
  app.get(
    "/v1/backups/status",
    { schema: { response: { 200: BackupStatusSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, {});
      if (owner === null) {
        return reply;
      }

      const [verified, latest, rehearsal] = await Promise.all([
        lastVerifiedBackupAtDestination(deps.db, deps.workspaceId),
        latestBackupVerificationStatus(deps.db, deps.workspaceId),
        lastTestRestoration(deps.db, deps.workspaceId),
      ]);
      const now = (deps.now ?? (() => new Date()))();
      const rehearsalDue =
        rehearsal === null ||
        now.getTime() - rehearsal.startedAt.getTime() > REHEARSAL_AFTER_DAYS * 24 * 60 * 60 * 1000;
      const outcome =
        rehearsal?.outcome === "succeeded" || rehearsal?.outcome === "failed"
          ? rehearsal.outcome
          : null;

      return reply.status(200).send({
        lastVerifiedAt: verified?.checkedAt.toISOString() ?? null,
        lastVerifiedBackupId: verified?.backupId ?? null,
        latestBackupAt: latest?.createdAt.toISOString() ?? null,
        latestBackupId: latest?.backupId ?? null,
        latestCreationVerification: latest?.afterCreation ?? null,
        latestTransferVerification: latest?.afterTransfer ?? null,
        lastRehearsalAt: rehearsal?.startedAt.toISOString() ?? null,
        lastRehearsalOutcome: outcome,
        stale: backupIsStale(verified?.checkedAt ?? null, now),
        rehearsalDue,
      });
    },
  );

  app.post(
    "/v1/backups/rehearsals",
    { schema: { response: { 200: RehearsalResultSchema } } },
    async (request, reply) => {
      const owner = deps.require(request, reply, { csrf: true });
      if (owner === null) {
        return reply;
      }
      if (deps.runRehearsal === undefined) {
        return sendSecurityProblem(reply, {
          code: "internal_error",
          correlationId: requestContext(request).correlationId,
        });
      }
      const result = await deps.runRehearsal();
      if (result.code !== 0) {
        request.log.warn({ exitCode: result.code }, "owner-requested backup rehearsal was refused");
        return sendSecurityProblem(reply, {
          code: result.code === 7 ? "internal_error" : "conflict",
          correlationId: requestContext(request).correlationId,
        });
      }
      return reply.status(200).send({
        outcome: "succeeded" as const,
        restoredItemCount: Number(result.data?.["restoredItemCount"] ?? 0),
        restoredFileCount: Number(result.data?.["restoredFileCount"] ?? 0),
      });
    },
  );
}
