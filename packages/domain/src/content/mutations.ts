/**
 * Typed mutation dispatch and idempotent results (T073, US4).
 *
 * Every canonical change is one of the owned command types below. Payloads
 * arriving from any transport (HTTP routes, offline outbox batches) are
 * parsed into the same typed commands before validation, so the server and
 * the browser projection enforce identical rules.
 */

import {
  DATABASE_COMMAND_TYPES,
  type DatabaseMutationCommand,
  parseDatabaseMutationCommand,
} from "../databases/commands.ts";
import { isUuid, type Uuid } from "../ids/uuid.ts";
import type { MutationRecord, QueuedMutationResult } from "../revisions/types.ts";
import {
  type DomainResult,
  err,
  isSafeErrorCode,
  ok,
  type PageDocument,
  type PlacementKind,
} from "./types.ts";

export const COMMAND_TYPES = [
  "item.create",
  "item.rename",
  "item.convert",
  "item.favourite",
  "item.offline",
  "item.trash",
  "item.restore",
  "placement.move",
  "placement.remove",
  "file.placement.add",
  "page.document.replace",
  "document.resolve-conflict",
  "relationship.create",
  "relationship.remove",
  "revision.restore",
  ...DATABASE_COMMAND_TYPES,
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export type MutationCommand =
  | {
      readonly type: "item.create";
      readonly id: Uuid;
      readonly kind: "page" | "folder";
      readonly name: string;
      readonly placement: {
        readonly id?: Uuid;
        readonly kind: PlacementKind;
        readonly parentItemId: Uuid | null;
        readonly positionKey: string;
      };
      readonly pageDocument?: PageDocument;
    }
  | { readonly type: "item.rename"; readonly itemId: Uuid; readonly name: string }
  | {
      readonly type: "item.convert";
      readonly itemId: Uuid;
      readonly targetKind: "page" | "folder";
      /** Carried in the command so a replay cannot destroy unconfirmed content. */
      readonly confirmedDestruction: boolean;
    }
  | {
      readonly type: "item.favourite";
      readonly itemId: Uuid;
      /**
       * The state being asked for, not a toggle.
       *
       * A toggle command replayed twice lands on the opposite answer from the
       * one the owner gave, and the outbox replays. Naming the desired state
       * makes the command idempotent by construction.
       */
      readonly favourite: boolean;
    }
  | {
      readonly type: "item.offline";
      readonly itemId: Uuid;
      /**
       * The state being asked for, like `item.favourite` and for the same
       * reason: the outbox replays, and a toggle replayed an even number of
       * times lands on the answer the owner did not give.
       */
      readonly offline: boolean;
    }
  | { readonly type: "item.trash"; readonly itemId: Uuid }
  | {
      readonly type: "item.restore";
      readonly itemId: Uuid;
      readonly fallbackParentItemId?: Uuid | null;
    }
  | {
      readonly type: "placement.move";
      readonly placementId: Uuid;
      readonly parentItemId: Uuid | null;
      readonly positionKey: string;
    }
  | { readonly type: "placement.remove"; readonly placementId: Uuid }
  | {
      readonly type: "file.placement.add";
      readonly itemId: Uuid;
      readonly kind: PlacementKind;
      readonly parentItemId: Uuid | null;
      readonly positionKey: string;
    }
  | {
      readonly type: "page.document.replace";
      readonly itemId: Uuid;
      readonly baseRevisionId: Uuid;
      readonly document: PageDocument;
      readonly pageLinkTargetIds?: readonly Uuid[];
    }
  /**
   * The owner's resolution of a genuine divergence (feature 006, FR-014, FR-016).
   *
   * Distinct from `page.document.replace` for one reason that matters: it names
   * *both* revisions it resolves, and the revision it produces descends from
   * both. That is what makes "the original versions are kept" a property of the
   * lineage rather than a retention policy someone has to honour — neither source
   * is rewritten, and both stay reachable as ancestors forever.
   *
   * It is also why this is not a replace with extra arguments. A replace has one
   * parent, so recording the second would be recording it somewhere the lineage
   * does not look.
   */
  | {
      readonly type: "document.resolve-conflict";
      readonly itemId: Uuid;
      /** Both conflicting revisions, in no significant order. */
      readonly resolvedRevisionIds: readonly [Uuid, Uuid];
      readonly document: PageDocument;
      readonly pageLinkTargetIds?: readonly Uuid[];
    }
  | {
      readonly type: "relationship.create";
      readonly id: Uuid;
      readonly sourceItemId: Uuid;
      readonly targetItemId: Uuid;
      readonly relationType: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "relationship.remove"; readonly relationshipId: Uuid }
  | {
      readonly type: "revision.restore";
      readonly revisionId: Uuid;
      readonly currentRevisionId: Uuid;
    }
  | DatabaseMutationCommand;

type Payload = Readonly<Record<string, unknown>>;

function requireUuid(payload: Payload, field: string): Uuid | null {
  const value = payload[field];
  return isUuid(value) ? value : null;
}

function optionalNullableUuid(
  payload: Payload,
  field: string,
): { present: boolean; value: Uuid | null } | "invalid" {
  if (!(field in payload)) {
    return { present: false, value: null };
  }
  const value = payload[field];
  if (value === null) {
    return { present: true, value: null };
  }
  return isUuid(value) ? { present: true, value } : "invalid";
}

function parsePlacementSpec(
  value: unknown,
): { id?: Uuid; kind: PlacementKind; parentItemId: Uuid | null; positionKey: string } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const spec = value as Payload;
  const kind = spec["kind"];
  if (kind !== "hierarchy" && kind !== "attachment") {
    return null;
  }
  const parent = spec["parentItemId"];
  if (parent !== null && !isUuid(parent)) {
    return null;
  }
  const positionKey = spec["positionKey"];
  if (typeof positionKey !== "string" || positionKey.length === 0) {
    return null;
  }
  const id = spec["id"];
  if (id !== undefined && !isUuid(id)) {
    return null;
  }
  return {
    ...(id !== undefined ? { id } : {}),
    kind,
    parentItemId: parent as Uuid | null,
    positionKey,
  };
}

function parsePageDocument(value: unknown): PageDocument | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const document = value as Payload;
  if (
    document["format"] !== "myownnotion.document+json" ||
    typeof document["formatVersion"] !== "number" ||
    typeof document["body"] !== "object" ||
    document["body"] === null ||
    Array.isArray(document["body"])
  ) {
    return null;
  }
  return {
    format: "myownnotion.document+json",
    formatVersion: document["formatVersion"],
    body: document["body"] as Readonly<Record<string, unknown>>,
  };
}

const invalid = (): DomainResult<MutationCommand> =>
  err("validation.invalid-payload", "Mutation payload does not match its command type");

/**
 * Parses an untrusted `commandType` + `payload` pair into a typed command.
 * Unknown command types and malformed payloads are rejected with safe errors.
 */
export function parseMutationCommand(
  commandType: string,
  payload: Payload,
): DomainResult<MutationCommand> {
  switch (commandType as CommandType) {
    case "item.create": {
      const id = requireUuid(payload, "id");
      const kind = payload["kind"];
      const name = payload["name"];
      const placement = parsePlacementSpec(payload["placement"]);
      if (
        id === null ||
        (kind !== "page" && kind !== "folder") ||
        typeof name !== "string" ||
        placement === null
      ) {
        return invalid();
      }
      if ("pageDocument" in payload && payload["pageDocument"] !== undefined) {
        const document = parsePageDocument(payload["pageDocument"]);
        if (document === null) {
          return invalid();
        }
        return ok({ type: "item.create", id, kind, name, placement, pageDocument: document });
      }
      return ok({ type: "item.create", id, kind, name, placement });
    }
    case "item.rename": {
      const itemId = requireUuid(payload, "itemId");
      const name = payload["name"];
      if (itemId === null || typeof name !== "string") {
        return invalid();
      }
      return ok({ type: "item.rename", itemId, name });
    }
    case "item.convert": {
      const itemId = requireUuid(payload, "itemId");
      const targetKind = payload["targetKind"];
      if (itemId === null || (targetKind !== "page" && targetKind !== "folder")) {
        return invalid();
      }
      // Absent means not confirmed. Defaulting the other way would let a
      // caller destroy content by omitting a field.
      const confirmedDestruction = payload["confirmedDestruction"] === true;
      return ok({ type: "item.convert", itemId, targetKind, confirmedDestruction });
    }
    case "item.favourite": {
      const itemId = requireUuid(payload, "itemId");
      const favourite = payload["favourite"];
      if (itemId === null || typeof favourite !== "boolean") {
        return invalid();
      }
      return ok({ type: "item.favourite", itemId, favourite });
    }
    case "item.offline": {
      const itemId = requireUuid(payload, "itemId");
      const offline = payload["offline"];
      if (itemId === null || typeof offline !== "boolean") {
        return invalid();
      }
      return ok({ type: "item.offline", itemId, offline });
    }
    case "item.trash": {
      const itemId = requireUuid(payload, "itemId");
      return itemId === null ? invalid() : ok({ type: "item.trash", itemId });
    }
    case "item.restore": {
      const itemId = requireUuid(payload, "itemId");
      if (itemId === null) {
        return invalid();
      }
      const fallback = optionalNullableUuid(payload, "fallbackParentItemId");
      if (fallback === "invalid") {
        return invalid();
      }
      return fallback.present
        ? ok({ type: "item.restore", itemId, fallbackParentItemId: fallback.value })
        : ok({ type: "item.restore", itemId });
    }
    case "placement.move": {
      const placementId = requireUuid(payload, "placementId");
      const parent = payload["parentItemId"];
      const positionKey = payload["positionKey"];
      if (
        placementId === null ||
        (parent !== null && !isUuid(parent)) ||
        typeof positionKey !== "string"
      ) {
        return invalid();
      }
      return ok({
        type: "placement.move",
        placementId,
        parentItemId: parent as Uuid | null,
        positionKey,
      });
    }
    case "placement.remove": {
      const placementId = requireUuid(payload, "placementId");
      return placementId === null ? invalid() : ok({ type: "placement.remove", placementId });
    }
    case "file.placement.add": {
      const itemId = requireUuid(payload, "itemId");
      const spec = parsePlacementSpec(payload);
      if (itemId === null || spec === null) {
        return invalid();
      }
      return ok({ type: "file.placement.add", itemId, ...spec });
    }
    case "page.document.replace": {
      const itemId = requireUuid(payload, "itemId");
      const baseRevisionId = requireUuid(payload, "baseRevisionId");
      const document = parsePageDocument(payload["document"]);
      if (itemId === null || baseRevisionId === null || document === null) {
        return invalid();
      }
      const rawTargets = payload["pageLinkTargetIds"];
      if (rawTargets !== undefined && !Array.isArray(rawTargets)) {
        return invalid();
      }
      const pageLinkTargetIds = (rawTargets ?? []).map((target) =>
        isUuid(target) ? target : null,
      );
      if (pageLinkTargetIds.some((target) => target === null)) {
        return invalid();
      }
      return ok({
        type: "page.document.replace",
        itemId,
        baseRevisionId,
        document,
        ...(rawTargets !== undefined ? { pageLinkTargetIds: pageLinkTargetIds as Uuid[] } : {}),
      });
    }
    case "document.resolve-conflict": {
      const itemId = requireUuid(payload, "itemId");
      const document = parsePageDocument(payload["document"]);
      const rawResolved = payload["resolvedRevisionIds"];
      if (itemId === null || document === null || !Array.isArray(rawResolved)) {
        return invalid();
      }
      // Exactly two, and distinct. One would be an ordinary edit wearing this
      // command's name; three would be a shape nothing produces and nothing
      // reads. And a "resolution" of a revision with itself resolves nothing —
      // accepting it would write a two-parent revision whose parents are the
      // same, which reads in the history as a conflict that never existed.
      const resolved = rawResolved.map((value) => (isUuid(value) ? value : null));
      if (
        resolved.length !== 2 ||
        resolved.some((value) => value === null) ||
        resolved[0] === resolved[1]
      ) {
        return invalid();
      }
      const rawTargets = payload["pageLinkTargetIds"];
      if (rawTargets !== undefined && !Array.isArray(rawTargets)) {
        return invalid();
      }
      const targets = (rawTargets ?? []).map((target) => (isUuid(target) ? target : null));
      if (targets.some((target) => target === null)) {
        return invalid();
      }
      return ok({
        type: "document.resolve-conflict",
        itemId,
        resolvedRevisionIds: [resolved[0], resolved[1]] as [Uuid, Uuid],
        document,
        ...(rawTargets !== undefined ? { pageLinkTargetIds: targets as Uuid[] } : {}),
      });
    }
    case "relationship.create": {
      const id = requireUuid(payload, "id");
      const sourceItemId = requireUuid(payload, "sourceItemId");
      const targetItemId = requireUuid(payload, "targetItemId");
      const relationType = payload["relationType"];
      if (
        id === null ||
        sourceItemId === null ||
        targetItemId === null ||
        typeof relationType !== "string"
      ) {
        return invalid();
      }
      const metadata = payload["metadata"];
      if (metadata !== undefined && (typeof metadata !== "object" || metadata === null)) {
        return invalid();
      }
      return ok({
        type: "relationship.create",
        id,
        sourceItemId,
        targetItemId,
        relationType,
        ...(metadata !== undefined
          ? { metadata: metadata as Readonly<Record<string, unknown>> }
          : {}),
      });
    }
    case "relationship.remove": {
      const relationshipId = requireUuid(payload, "relationshipId");
      return relationshipId === null
        ? invalid()
        : ok({ type: "relationship.remove", relationshipId });
    }
    case "revision.restore": {
      const revisionId = requireUuid(payload, "revisionId");
      const currentRevisionId = requireUuid(payload, "currentRevisionId");
      if (revisionId === null || currentRevisionId === null) {
        return invalid();
      }
      return ok({ type: "revision.restore", revisionId, currentRevisionId });
    }
    default:
      if ((DATABASE_COMMAND_TYPES as readonly string[]).includes(commandType)) {
        return parseDatabaseMutationCommand(commandType as never, payload);
      }
      return err("validation.invalid-payload", "Unknown mutation command type");
  }
}

/**
 * Idempotent replay semantics (FR-040): replaying an accepted mutation ID
 * returns the prior result without side effects; replaying a rejected one
 * returns the prior rejection.
 *
 * The replay preserves the recorded failure code rather than flattening every
 * rejection to a generic one. A client that only ever sees the replay must
 * still be able to tell a competing revision from a malformed command, because
 * it keeps the local work recoverable on that basis (FR-042).
 */
export function replayResult(prior: MutationRecord): QueuedMutationResult {
  if (prior.status === "accepted") {
    return {
      mutationId: prior.id,
      status: "already-accepted",
      revisionIds: prior.resultRevisionIds,
    };
  }
  const isConflict =
    prior.failureCode === "mutation.conflict" || prior.failureCode === "revision.stale-base";
  const competingRevisionIds = prior.competingRevisionIds ?? [];
  return {
    mutationId: prior.id,
    status: isConflict ? "conflict" : "rejected",
    // Returning the recorded identities makes a replay as informative as the
    // first response, so a client that only ever sees the replay can still
    // resolve the conflict (FR-042).
    ...(competingRevisionIds.length > 0 ? { competingRevisionIds } : {}),
    problem: {
      // The stored code is an untrusted string: validate before surfacing it.
      code: isSafeErrorCode(prior.failureCode) ? prior.failureCode : "mutation.rejected",
      title: isConflict
        ? "Mutation previously conflicted with a competing revision"
        : "Mutation was previously rejected",
      ...(competingRevisionIds.length > 0 ? { competingRevisionIds } : {}),
    },
  };
}
