/**
 * Mutation submission plumbing shared by every mutating route (T075, US4).
 *
 * Extracts and validates the Idempotency-Key header (the stable UUIDv7
 * mutation identity), runs the typed command through the transactional
 * executor, and translates results into contract responses: accepted and
 * already-accepted replays return the mutation result; rejections and
 * conflicts return safe problems.
 */

import { type Database, readItem, submitMutation } from "@myownnotion/database";
import { isUuid, type MutationCommand, type Uuid } from "@myownnotion/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendProblem } from "./errors.ts";

export function mutationIdFrom(request: FastifyRequest): Uuid | null {
  const header = request.headers["idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  return isUuid(value) ? value : null;
}

export async function handleMutation(input: {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly command: MutationCommand;
  readonly successStatus?: number;
}): Promise<FastifyReply> {
  const mutationId = mutationIdFrom(input.request);
  if (mutationId === null) {
    return sendProblem(input.reply, {
      code: "validation.invalid-identifier",
      title: "Idempotency-Key header must be a UUID mutation identity",
    });
  }

  const outcome = await submitMutation(input.db, {
    workspaceId: input.workspaceId,
    mutationId,
    commandType: input.command.type,
    command: input.command,
  });

  const { result } = outcome;
  if (result.status === "accepted" || result.status === "already-accepted") {
    const revisionIds = result.revisionIds ?? [];
    const primaryItemId = outcome.primaryItemId;
    const item = primaryItemId === undefined ? null : await readItem(input.db, primaryItemId);
    return input.reply
      .status(result.status === "accepted" ? (input.successStatus ?? 200) : 200)
      .send({
        mutationId: result.mutationId,
        revisionIds,
        ...(item !== null ? { item } : {}),
      });
  }

  return sendProblem(
    input.reply,
    result.problem ?? { code: "mutation.rejected", title: "Mutation rejected" },
  );
}
