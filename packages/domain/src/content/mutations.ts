/**
 * Typed mutation dispatch and idempotent results (T073, US4).
 *
 * Every canonical change is one of the owned command types below. Payloads
 * arriving from any transport (HTTP routes, offline outbox batches) are
 * parsed into the same typed commands before validation, so the server and
 * the browser projection enforce identical rules.
 */
import { isUuid, type Uuid } from "../ids/uuid.ts";
import { err, ok, type DomainResult, type PageDocument, type PlacementKind } from "./types.ts";
import type { MutationRecord, QueuedMutationResult } from "../revisions/types.ts";

export const COMMAND_TYPES = [
  "item.create",
  "item.rename",
  "item.trash",
  "item.restore",
  "placement.move",
  "placement.remove",
  "file.placement.add",
  "page.document.replace",
  "relationship.create",
  "relationship.remove",
  "revision.restore",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

export type MutationCommand =
  | {
      readonly type: "item.create";
      readonly id: Uuid;
      readonly kind: "page" | "folder";
      readonly name: string;
      readonly placement: {
        readonly kind: PlacementKind;
        readonly parentItemId: Uuid | null;
        readonly positionKey: string;
      };
      readonly pageDocument?: PageDocument;
    }
  | { readonly type: "item.rename"; readonly itemId: Uuid; readonly name: string }
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
    };

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
): { kind: PlacementKind; parentItemId: Uuid | null; positionKey: string } | null {
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
  return { kind, parentItemId: parent as Uuid | null, positionKey };
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
      return ok({ type: "page.document.replace", itemId, baseRevisionId, document });
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
      return err("validation.invalid-payload", "Unknown mutation command type");
  }
}

/**
 * Idempotent replay semantics (FR-040): replaying an accepted mutation ID
 * returns the prior result without side effects; replaying a rejected one
 * returns the prior rejection.
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
  return {
    mutationId: prior.id,
    status: isConflict ? "conflict" : "rejected",
    problem: {
      code: "mutation.rejected",
      title: "Mutation was previously rejected",
    },
  };
}
