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
  attributeRevisionsToDevice,
  type Database,
  listDatabasePropertyRelationships,
  readCurrentDatabaseDefinition,
  readCurrentDatabaseEntryValues,
  readDatabaseEntryRecord,
  readDatabaseRecord,
  readItem,
  readItemPresentation,
  readRelationshipMetadata,
  readRevisionSnapshots,
  SCRUBBED_PLACEHOLDER,
  submitMutation,
  type Transaction,
} from "@myownnotion/database";
import { isUuid, type MutationCommand, type SafeError, type Uuid } from "@myownnotion/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DatabaseQueryService } from "../databases/database-query-service.ts";
import type { SearchService } from "../search/search-service.ts";
import { resolveProtectedContent } from "../security/content-resolution.ts";
import type { ProtectedContent } from "../security/protected-content.ts";
import { requestContext } from "../security/request-context.ts";
import type { RotationPolicyService } from "../security/rotation-policy-service.ts";
import { announceCommitted } from "../sync/change-notifier.ts";
import { sendProblem } from "./errors.ts";
import { requireWriteProtocol } from "./protocol.ts";

/**
 * The attribution to record for this request, if it has one (FR-022).
 *
 * Returns `undefined` for an anonymous request rather than inventing a device.
 * A history entry reading "device unknown" is honest; one that guesses is worse
 * than silence, and this is the only place that decides which it is.
 */
export function attributionFor(
  request: FastifyRequest,
  mutationId: Uuid,
): { readonly mutationId: Uuid; readonly deviceId: string } | undefined {
  const principal = requestContext(request).principal;
  return principal.kind === "owner" ? { mutationId, deviceId: principal.deviceId } : undefined;
}

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

  if (command.type === "page.document.replace" || command.type === "document.resolve-conflict") {
    // A resolution writes a page body exactly as an edit does, so it is sealed
    // by the same branch. Sealing is about what a command *stored*, never about
    // why it stored it — and a resolution left out of this list would be the one
    // write that commits an owner's words in the clear.
    await protectedContent.writePageBody(tx, {
      pageId: command.itemId,
      recordVersion: 1,
      body: command.document.body,
    });
  }
  if (command.type === "database.entry.create" && command.document !== undefined) {
    await protectedContent.writePageBody(tx, {
      pageId: command.id,
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
  if (
    command.type === "database.create" ||
    command.type === "database.definition.replace" ||
    command.type === "database.definition.resolve-conflict"
  ) {
    const databaseId = command.type === "database.create" ? command.id : command.databaseId;
    const record = await readDatabaseRecord(tx, databaseId);
    const definition = await readCurrentDatabaseDefinition(tx, databaseId);
    if (record !== null && definition !== null) {
      await protectedContent.writeDatabaseDefinition(tx, {
        databaseId,
        definitionVersion: record.definitionVersion,
        definition,
      });
    }
  }
  if (
    command.type === "database.entry.create" ||
    command.type === "database.entry.values.replace" ||
    command.type === "database.entry.values.resolve-conflict"
  ) {
    const entryId = command.type === "database.entry.create" ? command.id : command.entryId;
    const record = await readDatabaseEntryRecord(tx, entryId);
    const values = await readCurrentDatabaseEntryValues(tx, entryId);
    const propertyRelationships = await listDatabasePropertyRelationships(tx, entryId);
    if (record !== null && values !== null) {
      await protectedContent.writeDatabaseEntryValues(tx, {
        entryId,
        valueVersion: record.valueVersion,
        values,
      });
    }
    for (const relationship of propertyRelationships) {
      await protectedContent.writeRelationshipMetadata(tx, {
        relationshipId: relationship.id,
        recordVersion: 1,
        metadata: relationship.metadata,
      });
    }
  }
  // The title, whatever created or renamed it. Read back from the row the
  // mutation just wrote rather than taken from the command, so a rename and a
  // creation are handled by one branch and a command shape that carries the
  // name differently cannot slip past.
  if (primaryItemId !== undefined) {
    // A successful command returning a primary item id has just written that
    // row in this transaction. Treating a missing row as a recoverable branch
    // would let accepted content escape sealing; a broken invariant must throw
    // and roll the transaction back instead.
    const presentation = (await readItemPresentation(tx, primaryItemId)) as {
      readonly name: string;
      readonly icon: string | null;
    };
    // After encryption cutover the relational title is deliberately replaced
    // by U+FFFD. Presentation-neutral writes (favourite, offline intent) and
    // icon-only writes must not seal that marker over the real title. Read
    // the current envelope in the same transaction and retain its title;
    // an actual rename has already written a non-placeholder title and takes
    // the ordinary branch.
    const current =
      presentation.name === SCRUBBED_PLACEHOLDER
        ? await protectedContent.readItemPresentation(tx, primaryItemId)
        : null;
    await protectedContent.writeItemPresentation(tx, {
      itemId: primaryItemId,
      recordVersion: 1,
      name: current?.name ?? presentation.name,
      icon: presentation.icon,
    });
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
  /**
   * Which mutation this is and which device is writing it (FR-022).
   *
   * The device comes from the request's principal, never from the payload: a
   * history whose author the client could choose is a history an owner cannot
   * trust, and being trusted is the only thing a history is for. Absent for an
   * anonymous request and for the feature-001 harness, which has no devices —
   * and "device unknown" is then recorded honestly as null.
   */
  attribution?: { readonly mutationId: Uuid; readonly deviceId: string } | undefined,
) {
  if (protectedContent === undefined && attribution === undefined) {
    // Feature-001 harnesses build an app with no security layer at all and must
    // keep writing; there is nothing to seal, no policy to consult, and no
    // device to name.
    return {};
  }
  return {
    onAccepted: async (
      tx: Transaction,
      accepted: { primaryItemId?: Uuid; revisionIds: readonly Uuid[] },
    ) => {
      if (attribution !== undefined) {
        await attributeRevisionsToDevice(tx, attribution);
      }
      if (protectedContent === undefined) {
        return;
      }
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
  /** Refreshes the transient index after, and only after, a canonical commit. */
  readonly search?: SearchService | undefined;
  /** Refreshes the saved-view projection after, and only after, a canonical commit. */
  readonly structuredQueries?: DatabaseQueryService | undefined;
  /** Allows feature routes to return their aggregate read model after commit. */
  readonly successBody?:
    | ((accepted: {
        readonly mutationId: Uuid;
        readonly revisionIds: readonly Uuid[];
        readonly primaryItemId?: Uuid;
      }) => Promise<unknown>)
    | undefined;
  /** Allows a route-specific contract to represent one domain rejection. */
  readonly problemResponse?:
    | ((problem: SafeError) => { readonly status: number; readonly body: unknown } | undefined)
    | undefined;
}): Promise<FastifyReply> {
  // Before anything is read or written. A client too old to write safely is
  // refused with the version it needs (FR-018), and refusing here rather than
  // inside the transaction means the refusal costs nothing and cannot leave a
  // partial write behind.
  requireWriteProtocol(input.request);

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
    ...acceptedWriteGuards(
      command,
      protectedContent,
      input.rotationPolicies,
      attributionFor(input.request, mutationId),
    ),
  });

  // After the transaction returned, which is the only moment a device can be
  // told to read and find the change there (feature 006, FR-001).
  announceCommitted(outcome.committedSequence);
  if (
    outcome.committedSequence !== undefined &&
    outcome.changedItemIds !== undefined &&
    input.search !== undefined
  ) {
    try {
      await input.search.applyCommittedChanges(outcome.changedItemIds, outcome.committedSequence);
    } catch {
      // The canonical write already committed. Search invalidates itself and
      // rebuilds; the owner still receives the successful mutation result.
    }
  }
  if (
    outcome.committedSequence !== undefined &&
    outcome.changedItemIds !== undefined &&
    input.structuredQueries !== undefined
  ) {
    try {
      await input.structuredQueries.applyCommittedChanges(
        outcome.changedItemIds,
        outcome.committedSequence,
      );
    } catch {
      // The canonical write already committed. The projection refuses stale
      // completeness and starts a rebuild; the write response remains valid.
    }
  }

  const { result } = outcome;
  if (result.status === "accepted" || result.status === "already-accepted") {
    const revisionIds = result.revisionIds ?? [];
    const primaryItemId = outcome.primaryItemId;
    const storedItem = primaryItemId === undefined ? null : await readItem(input.db, primaryItemId);
    const item =
      storedItem === null
        ? null
        : ((await resolveProtectedContent(input.db, [storedItem], input.protectedContent))[0] ??
          null);

    const body =
      input.successBody === undefined
        ? {
            mutationId: result.mutationId,
            revisionIds,
            ...(item !== null ? { item } : {}),
          }
        : await input.successBody({
            mutationId: result.mutationId,
            revisionIds,
            ...(primaryItemId === undefined ? {} : { primaryItemId }),
          });
    return input.reply
      .status(result.status === "accepted" ? (input.successStatus ?? 200) : 200)
      .send(body);
  }

  if (result.problem !== undefined && input.problemResponse !== undefined) {
    const response = input.problemResponse(result.problem);
    if (response !== undefined) {
      return input.reply
        .status(response.status)
        .header("content-type", "application/problem+json")
        .send(response.body);
    }
  }

  return sendProblem(
    input.reply,
    result.problem ?? { code: "mutation.rejected", title: "Mutation rejected" },
  );
}
