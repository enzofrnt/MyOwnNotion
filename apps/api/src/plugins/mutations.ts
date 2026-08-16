/**
 * Mutation submission plumbing shared by every mutating route (T075, US4).
 *
 * Extracts and validates the Idempotency-Key header (the stable UUIDv7
 * mutation identity), runs the typed command through the transactional
 * executor, and translates results into contract responses: accepted and
 * already-accepted replays return the mutation result; rejections and
 * conflicts return safe problems.
 */

import {
  type Database,
  readItem,
  readItemName,
  readRelationshipMetadata,
  readRevisionSnapshots,
  submitMutation,
  type Transaction,
} from "@myownnotion/database";
import { isUuid, type MutationCommand, type Uuid } from "@myownnotion/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProtectedContent } from "../security/protected-content.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import { sendProblem } from "./errors.ts";

export function mutationIdFrom(request: FastifyRequest): Uuid | null {
  const header = request.headers["idempotency-key"];
  const value = Array.isArray(header) ? header[0] : header;
  return isUuid(value) ? value : null;
}

/**
 * Seals the payload-bearing fields a command touched, inside its transaction.
 *
 * Every mutating route funnels through `handleMutation`, so sealing in one
 * place is what keeps a new route from silently storing plaintext — a route
 * author has to opt out rather than remember to opt in.
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
  tx: Transaction,
  command: MutationCommand,
  primaryItemId: string | undefined,
  revisionIds: readonly string[],
): Promise<void> {
  // **The snapshots first, because they are the largest exposure.** A snapshot
  // is the whole record as it stood, so sealing only the current title and
  // body would leave every previous state of every page readable in the
  // clear — and a scrub of the current rows would then remove nothing that
  // mattered.
  //
  // A revision is immutable, so each snapshot is sealed once, at record
  // version 1, and never rewritten.
  const snapshots = await readRevisionSnapshots(tx, revisionIds);
  for (const [revisionId, snapshot] of snapshots) {
    await protectedContent.writeRevisionSnapshot(tx, { revisionId, snapshot });
  }

  if (command.type === "page.document.replace") {
    await protectedContent.writePageBody(tx, {
      pageId: command.itemId,
      recordVersion: 1,
      body: command.document.body,
    });
  }
  // A relationship's metadata: the free-form note explaining *why* two items
  // are related, which is often more revealing than either title. The
  // endpoints and the relation type stay in the clear so the graph can be
  // traversed without a key, exactly as the hierarchy can.
  if (command.type === "relationship.create") {
    const metadata = await readRelationshipMetadata(tx, command.id);
    if (metadata !== null) {
      await protectedContent.writeRelationshipMetadata(tx, {
        relationshipId: command.id,
        recordVersion: 1,
        metadata,
      });
    }
  }
  // The title, whatever created or renamed it. Read back from the row the
  // mutation just wrote rather than taken from the command, so a rename and a
  // creation are handled by one branch and a command shape that carries the
  // name differently cannot slip past.
  if (primaryItemId !== undefined) {
    const name = await readItemName(tx, primaryItemId);
    if (name !== null) {
      await protectedContent.writeItemName(tx, {
        itemId: primaryItemId,
        recordVersion: 1,
        name,
      });
    }
  }
}

/**
 * The guarantees every accepted write carries, whichever route accepted it.
 *
 * Extracted because the offline batch route had neither of them. That route is
 * not a secondary path — it is the one the browser client uses for everything
 * it queued while offline, which is most of what an owner writes. Two rules
 * that the single-command routes enforced were therefore absent from the busiest
 * one: a rotation write block did not refuse the write, and the content was
 * committed without being sealed.
 *
 * Both live inside the mutation's transaction. A check taken before it can be
 * overtaken by a block committing in between, and sealing outside it would let
 * content commit without its envelope.
 */
export function acceptedWriteGuards(
  command: MutationCommand,
  protectedContent: ProtectedContent | undefined,
  rotationPolicies: RotationPolicyService | undefined,
) {
  if (protectedContent === undefined) {
    // Feature-001 harnesses build an app with no security layer at all and must
    // keep writing; there is nothing to seal and no policy to consult.
    return {};
  }
  return {
    onAccepted: async (
      tx: Transaction,
      accepted: { primaryItemId?: Uuid; revisionIds: readonly Uuid[] },
    ) => {
      // Throws, so the whole mutation rolls back: a refused write leaves
      // neither content nor envelope behind.
      await rotationPolicies?.assertWritesAllowed(tx);
      await sealPayloads(
        protectedContent,
        tx,
        command,
        accepted.primaryItemId,
        accepted.revisionIds,
      );
    },
  };
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
  /**
   * Refuses protected writes once a rotation policy has reached its block.
   *
   * Optional for the same reason as the line above: the feature-001 harness
   * builds an app with no security layer and must keep writing.
   */
  readonly rotationPolicies?: RotationPolicyService | undefined;
}): Promise<FastifyReply> {
  const mutationId = mutationIdFrom(input.request);
  if (mutationId === null) {
    return sendProblem(input.reply, {
      code: "validation.invalid-identifier",
      title: "Idempotency-Key header must be a UUID mutation identity",
    });
  }

  // Bound once so the callback closes over a narrowed value rather than
  // re-reading an optional property.
  const protectedContent = input.protectedContent;
  const command = input.command;

  const outcome = await submitMutation(input.db, {
    workspaceId: input.workspaceId,
    mutationId,
    commandType: input.command.type,
    command,
    // Sealing happens inside the mutation's transaction. Content and its
    // envelope commit together or neither does, and there is no second round
    // trip on the request path.
    ...acceptedWriteGuards(command, protectedContent, input.rotationPolicies),
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
