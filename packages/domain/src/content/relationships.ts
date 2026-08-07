/**
 * Typed relationship validation and unavailable-target semantics (T065, US3).
 *
 * Relationships identify endpoints by stable identity only. Removal is an
 * explicit lineage event; references to trashed or purged items remain
 * diagnosable instead of being silently redirected or erased.
 */
import { isUuid, type Uuid } from "../ids/uuid.ts";
import { err, ok, type CanonicalItem, type DomainResult } from "./types.ts";

/** Owned namespaced vocabulary, e.g. `link:references`, `embed:file`. */
const RELATION_TYPE_PATTERN = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/;

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
  const source = getItem(command.sourceItemId);
  if (source === null || source.lifecycle === "purged") {
    return err("relationship.endpoint-unavailable", "Source item is unavailable");
  }
  const target = getItem(command.targetItemId);
  if (target === null || target.lifecycle === "purged") {
    return err("relationship.endpoint-unavailable", "Target item is unavailable");
  }
  const metadata = command.metadata ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    return err("validation.invalid-payload", "Relationship metadata must be an object");
  }
  return ok({
    id: command.id,
    sourceItemId: command.sourceItemId,
    targetItemId: command.targetItemId,
    relationType: command.relationType,
    metadata,
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
