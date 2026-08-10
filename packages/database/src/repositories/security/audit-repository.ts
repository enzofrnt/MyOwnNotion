/**
 * Append-only security audit repository (T020, feature 002).
 *
 * Every later phase writes through this module. It is the single place where
 * an audit row is created, which is what makes two guarantees checkable rather
 * than aspirational:
 *
 *   1. **Only allowlisted event types are persisted.** An unknown type is
 *      refused, not coerced. A free-form event name is how content ends up in
 *      an audit trail — "page.renamed to Quarterly Layoffs" is a leak even
 *      though it looks like a label.
 *   2. **Every payload is redacted, and the result is re-checked.** `redact()`
 *      runs first, then `containsUnredactedField()` verifies the outcome. The
 *      second pass is not redundant: it catches a forbidden field that a
 *      future change to the allowlist would let through, and it turns a silent
 *      leak into a loud failure at write time.
 *
 * Append-only is enforced by omission: this module exposes no update and no
 * delete. Nothing else may write the table.
 */

import { containsUnredactedField, redact, type SafeProblemCode } from "@myownnotion/domain";
import { and, desc, eq, gte } from "drizzle-orm";
import type { Database, Transaction } from "../../client.ts";
import { securityAuditEvents } from "../../schema/security/index.ts";
import { SecurityRepositoryError, type SecurityScope } from "./repository-types.ts";

type Executor = Database | Transaction;

/**
 * The complete set of persistable security events.
 *
 * Grouped by the axis they belong to so a reviewer can see at a glance whether
 * a flow is audited end to end. Adding a flow means adding its events here.
 */
export const SECURITY_EVENT_TYPES = [
  // Installation lifecycle
  "installation.created",
  "installation.state-changed",
  "installation.degraded",
  "installation.key-unavailable",
  // Bootstrap
  "bootstrap.started",
  "bootstrap.claim-conflict",
  "bootstrap.credential-verified",
  "bootstrap.kit-created",
  "bootstrap.kit-downloaded",
  "bootstrap.kit-regenerated",
  "bootstrap.kit-rejected",
  "bootstrap.confirmed",
  "bootstrap.abandoned",
  "bootstrap.interrupted",
  // Authentication and sessions
  "auth.passkey-enrolled",
  "auth.passkey-removed",
  "auth.password-set",
  "auth.succeeded",
  "auth.failed",
  "auth.reauthentication-required",
  "auth.rate-limited",
  "session.issued",
  "session.revoked",
  "session.revoked-all",
  "session.expired",
  "session.renewal-denied",
  "csrf.validation-failed",
  "cookie.policy-refused",
  // Devices
  "device.authorized",
  "device.renamed",
  "device.revoked",
  "device.reauthorization-required",
  // Recovery
  "recovery.kit-prepared",
  "recovery.kit-downloaded",
  "recovery.kit-download-consumed",
  "recovery.kit-confirmed",
  "recovery.kit-superseded",
  "recovery.kit-revoked",
  "recovery.kit-rejected",
  "recovery.kit-expired",
  "recovery.epoch-advanced",
  "recovery.adoption-completed",
  // Keys and rotation
  "rotation.started",
  "rotation.checkpoint",
  "rotation.completed",
  "rotation.failed",
  "rotation.write-blocked",
  "key.generation-created",
  "key.generation-retired",
  // Encryption migration
  "migration.started",
  "migration.checkpoint",
  "migration.verified",
  "migration.cutover",
  "migration.scrubbed",
  "migration.completed",
  "migration.failed",
  // Integrity and administration
  "integrity.envelope-rejected",
  "integrity.identity-drift-detected",
  "admin.cli-command-executed",
  "admin.cli-command-refused",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

const allowedEventTypes = new Set<string>(SECURITY_EVENT_TYPES);

export function isSecurityEventType(value: string): value is SecurityEventType {
  return allowedEventTypes.has(value);
}

export const AUDIT_OUTCOMES = ["success", "failure", "refused", "started"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/**
 * `hosting-admin` exists only for protected local CLI commands. There is no
 * remote administrator transport, so no HTTP route may ever write an event
 * with this actor class.
 */
export const AUDIT_ACTOR_CLASSES = ["owner", "hosting-admin", "system"] as const;
export type AuditActorClass = (typeof AUDIT_ACTOR_CLASSES)[number];

export interface AppendAuditEventInput {
  readonly id: string;
  readonly eventType: SecurityEventType;
  readonly outcome: AuditOutcome;
  readonly actorClass: AuditActorClass;
  readonly correlationId: string;
  readonly safeCode?: SafeProblemCode;
  readonly objectKind?: string;
  /** Opaque where safe. Never a value that reveals a title or a path. */
  readonly objectId?: string;
  /** Redacted before it is written; forbidden fields become `[redacted]`. */
  readonly metadata?: Record<string, unknown>;
  readonly occurredAt?: Date;
}

export interface SecurityAuditEvent {
  readonly id: string;
  readonly installationId: string;
  readonly workspaceId: string | null;
  readonly eventType: SecurityEventType;
  readonly outcome: AuditOutcome;
  readonly actorClass: AuditActorClass;
  readonly correlationId: string;
  readonly safeCode: string | null;
  readonly objectKind: string | null;
  readonly objectId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}

function toEvent(row: typeof securityAuditEvents.$inferSelect): SecurityAuditEvent {
  return {
    id: row.id,
    installationId: row.installationId,
    workspaceId: row.workspaceId,
    eventType: row.eventType as SecurityEventType,
    outcome: row.outcome as AuditOutcome,
    actorClass: row.actorClass as AuditActorClass,
    correlationId: row.correlationId,
    safeCode: row.safeCode,
    objectKind: row.objectKind,
    objectId: row.objectId,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    occurredAt: row.occurredAt,
  };
}

/**
 * Appends one event.
 *
 * Takes an `Executor`, so a caller can pass its own transaction and have the
 * audit row commit or roll back with the operation it describes. An audit
 * trail that records an action which then rolled back is worse than no trail.
 */
export async function appendAuditEvent(
  executor: Executor,
  scope: SecurityScope,
  input: AppendAuditEventInput,
): Promise<SecurityAuditEvent> {
  if (!isSecurityEventType(input.eventType)) {
    // Reached only from untyped callers; the allowlist is the contract.
    throw new SecurityRepositoryError(
      "internal_error",
      `unknown security event type: ${input.eventType}`,
    );
  }

  const redactedMetadata = (redact(input.metadata ?? {}) ?? {}) as Record<string, unknown>;
  if (containsUnredactedField(redactedMetadata)) {
    // Redaction ran and something still carries a forbidden field. Refusing the
    // write is the only safe outcome: a persisted leak cannot be un-persisted.
    throw new SecurityRepositoryError(
      "internal_error",
      "refusing to persist an audit row that still contains a forbidden field after redaction",
    );
  }

  const values = {
    id: input.id,
    installationId: scope.installationId,
    workspaceId: scope.workspaceId ?? null,
    eventType: input.eventType,
    outcome: input.outcome,
    actorClass: input.actorClass,
    correlationId: input.correlationId,
    safeCode: input.safeCode ?? null,
    objectKind: input.objectKind ?? null,
    objectId: input.objectId ?? null,
    metadata: redactedMetadata,
    ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
  };

  const inserted = await executor.insert(securityAuditEvents).values(values).returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new SecurityRepositoryError("internal_error", "audit event was not persisted");
  }
  return toEvent(row);
}

export interface ListAuditEventsOptions {
  readonly eventType?: SecurityEventType;
  readonly since?: Date;
  readonly limit?: number;
}

/** Newest first. Scoped to the installation; there is no cross-scope read. */
export async function listAuditEvents(
  executor: Executor,
  scope: SecurityScope,
  options: ListAuditEventsOptions = {},
): Promise<SecurityAuditEvent[]> {
  const filters = [eq(securityAuditEvents.installationId, scope.installationId)];
  if (options.eventType !== undefined) {
    filters.push(eq(securityAuditEvents.eventType, options.eventType));
  }
  if (options.since !== undefined) {
    filters.push(gte(securityAuditEvents.occurredAt, options.since));
  }
  const rows = await executor
    .select()
    .from(securityAuditEvents)
    .where(and(...filters))
    .orderBy(desc(securityAuditEvents.occurredAt), desc(securityAuditEvents.id))
    .limit(Math.min(options.limit ?? 100, 1000));
  return rows.map(toEvent);
}

export async function countAuditEvents(
  executor: Executor,
  scope: SecurityScope,
  eventType?: SecurityEventType,
): Promise<number> {
  const events = await listAuditEvents(executor, scope, {
    ...(eventType === undefined ? {} : { eventType }),
    limit: 1000,
  });
  return events.length;
}
