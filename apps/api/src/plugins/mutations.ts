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
import type { ProtectedContent } from "../security/protected-content.ts";
import { sendProblem } from "./errors.ts";

export function mutationIdFrom(request: FastifyRequest): Uuid | null {
  const header = request.headers["idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  return isUuid(value) ? value : null;
}

/**
 * Seals the payload-bearing fields a command touched.
 *
 * **Current content is sealed at record version 1 and upserted.** History is
 * not lost by that: a revision keeps its own immutable snapshot, and that is
 * where an earlier body lives. Versioning the current envelope as well would
 * store the same content twice under two schemes.
 *
 * Only fields a person wrote are sealed. Identifiers, kinds, ordering and
 * lifecycle stay in the clear so the workspace can be navigated without a key
 * — the boundary FR-011 draws, enforced here by what this function chooses to
 * pass along.
 */
async function sealPayloads(
  protectedContent: ProtectedContent,
  db: Database,
  command: MutationCommand,
  item: { id: string; name?: string } | null,
): Promise<void> {
  if (command.type === "page.document.replace") {
    await protectedContent.writePageBody(db, {
      pageId: command.itemId,
      recordVersion: 1,
      body: command.document.body,
    });
  }
  // The title, whatever created or renamed it. Read from the item the
  // mutation produced rather than from the command, so a rename and a
  // creation are handled by one branch and a command shape that carries the
  // name differently cannot slip past.
  if (item !== null && typeof item.name === "string") {
    await protectedContent.writeItemName(db, {
      itemId: item.id,
      recordVersion: 1,
      name: item.name,
    });
  }
}

export async function handleMutation(input: {
  readonly db: Database;
  readonly workspaceId: Uuid;
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly command: MutationCommand;
  readonly successStatus?: number;
  /**
   * Present only when the security layer is configured.
   *
   * Absent leaves feature-001 behaviour untouched, which is what lets the
   * feature-001 harness build an app with no deployment key and still write.
   */
  readonly protectedContent?: ProtectedContent | undefined;
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

    // The dual write. Every mutating route funnels through here, so sealing
    // in one place is what keeps a new route from silently storing plaintext
    // — a route author has to opt out rather than remember to opt in.
    //
    // It runs only after the mutation is accepted: sealing a payload for a
    // mutation that was then rejected would leave an envelope for content that
    // does not exist.
    if (input.protectedContent !== undefined) {
      await sealPayloads(input.protectedContent, input.db, input.command, item);
    }

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
