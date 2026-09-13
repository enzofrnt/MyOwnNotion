/**
 * Typed relationship validation and unavailable-target semantics (T065, US3).
 *
 * Relationships identify endpoints by stable identity only. Removal is an
 * explicit lineage event; references to trashed or purged items remain
 * diagnosable instead of being silently redirected or erased.
 */
import { isUuid, type Uuid } from "../ids/uuid.ts";
import {
  type CanonicalItem,
  type DomainResult,
  err,
  isProtectedContentPayload,
  ok,
} from "./types.ts";

/** Owned namespaced vocabulary, e.g. `link:references`, `embed:file`. */
const RELATION_TYPE_PATTERN = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/;

/** Managed only by page-document replacement so the index cannot drift. */
export const INTERNAL_PAGE_LINK_RELATION_TYPE = "page:link";

export function isValidRelationType(value: string): boolean {
  return RELATION_TYPE_PATTERN.test(value) && value.length <= 128;
}

export interface CreateRelationshipCommand {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateRelationshipPlan {
  readonly id: Uuid;
  readonly sourceItemId: Uuid;
  readonly targetItemId: Uuid;
  readonly relationType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Validates relationship metadata at every ingestion boundary.
 *
 * The protected-storage marker is a storage representation, so accepting it
 * as authored metadata would make a later restore indistinguishable from a
 * value that still needs to be resolved from its envelope.
 */
export function validateRelationshipMetadata(
  metadata: unknown,
): DomainResult<Readonly<Record<string, unknown>>> {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return err("validation.invalid-payload", "Relationship metadata must be an object");
  }
  if (isProtectedContentPayload(metadata)) {
    return err("validation.invalid-payload", "Relationship metadata uses a reserved value");
  }
  return ok(metadata as Readonly<Record<string, unknown>>);
}

export function validateCreateRelationship(
  getItem: (id: Uuid) => CanonicalItem | null,
  command: CreateRelationshipCommand,
): DomainResult<CreateRelationshipPlan> {
  if (!isUuid(command.id) || !isUuid(command.sourceItemId) || !isUuid(command.targetItemId)) {
    return err("validation.invalid-identifier", "Relationship identifiers must be UUIDs");
  }
  if (!isValidRelationType(command.relationType)) {
    return err("validation.invalid-payload", "Relation type must use the namespaced vocabulary");
  }
  if (command.relationType === INTERNAL_PAGE_LINK_RELATION_TYPE) {
    return err(
      "validation.invalid-payload",
      "Internal page links must be managed through the page document",
    );
  }
  const source = getItem(command.sourceItemId);
  if (source === null || source.lifecycle === "purged") {
    return err("relationship.endpoint-unavailable", "Source item is unavailable");
  }
  const target = getItem(command.targetItemId);
  if (target === null || target.lifecycle === "purged") {
    return err("relationship.endpoint-unavailable", "Target item is unavailable");
  }
  const metadataResult = validateRelationshipMetadata(
    command.metadata === undefined ? {} : command.metadata,
  );
  if (!metadataResult.ok) return metadataResult;
  return ok({
    id: command.id,
    sourceItemId: command.sourceItemId,
    targetItemId: command.targetItemId,
    relationType: command.relationType,
    metadata: metadataResult.value,
  });
}

export type EndpointAvailability = "active" | "trashed" | "unavailable";

/**
 * Diagnosable endpoint state (FR-011, FR-014): a surviving reference never
 * silently resolves to a different item; it reports the endpoint state.
 */
export function endpointAvailability(item: CanonicalItem | null): EndpointAvailability {
  if (item === null || item.lifecycle === "purged") {
    return "unavailable";
  }
  return item.lifecycle === "trashed" ? "trashed" : "active";
}
