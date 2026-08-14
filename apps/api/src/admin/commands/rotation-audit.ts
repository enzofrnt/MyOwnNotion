/**
 * Auditing a rotation (T087, US5, FR-022, FR-023, FR-035).
 *
 * A rotation is the longest-running thing this installation does, it moves key
 * material, and it can be interrupted. Those three facts together mean the
 * audit trail is not a formality here: it is the only account of what happened
 * to an operator arriving after the fact, usually because something looks
 * wrong.
 *
 * Three decisions shape this module.
 *
 * **The events that assert a change commit with it.** `rotation.started`,
 * every checkpoint, `rotation.completed` and `rotation.failed` are written in
 * the transaction that performs the work. An audit row that survived a
 * rolled-back batch would claim progress that did not happen — and on a
 * resumable operation, a phantom checkpoint is worse than no checkpoint,
 * because the resume trusts it.
 *
 * **The actor is always `hosting-admin`.** These commands run on the host, as
 * whoever can already read the mounted deployment key. Recording them as
 * `owner` would blur the one boundary FR-019 draws, and `system` would imply
 * nobody chose to run them.
 *
 * **Metadata carries counts, generations, and identifiers — never material.**
 * Everything here passes through the redactor on the way to the table, but
 * relying on that would be relying on a safety net rather than on not falling.
 * A fingerprint is included where it helps an operator confirm *which* key was
 * involved; the key itself is not, in any encoding.
 */

import type { Transaction } from "@myownnotion/database";
import type { AuditContext, AuditService } from "../../security/audit-service.ts";

export interface RotationAuditDeps {
  readonly audit: AuditService;
  readonly context: AuditContext;
}

/** Present only when the caller wired auditing; absent in unit tests. */
export type RotationAudit = RotationAuditDeps | undefined;

export async function auditRotationStarted(
  journal: RotationAudit,
  tx: Transaction,
  input: {
    kind: "wrapping-key" | "data-key";
    operationId: string;
    from: number;
    to: number;
    totalCount: number;
  },
): Promise<void> {
  await journal?.audit.recordInTransaction(tx, journal.context, {
    eventType: "rotation.started",
    outcome: "started",
    objectKind: `rotation:${input.kind}`,
    objectId: input.operationId,
    metadata: {
      from: input.from,
      to: input.to,
      // The size of the job, recorded at the start. It is what makes a later
      // checkpoint interpretable: "412 of 8000" says something, "412" does not.
      totalCount: input.totalCount,
    },
  });
}

export async function auditRotationCheckpoint(
  journal: RotationAudit,
  tx: Transaction,
  input: {
    kind: "wrapping-key" | "data-key";
    operationId: string;
    processedCount: number;
    totalCount: number;
    cursor: string;
  },
): Promise<void> {
  await journal?.audit.recordInTransaction(tx, journal.context, {
    eventType: "rotation.checkpoint",
    outcome: "success",
    objectKind: `rotation:${input.kind}`,
    objectId: input.operationId,
    metadata: {
      processedCount: input.processedCount,
      totalCount: input.totalCount,
      // The cursor is a row id or a workspace id: an identifier the
      // application already treats as public, and the only thing that lets an
      // operator tell a stalled rotation from a slow one.
      cursor: input.cursor,
    },
  });
}

export async function auditRotationCompleted(
  journal: RotationAudit,
  tx: Transaction,
  input: {
    kind: "wrapping-key" | "data-key";
    operationId: string;
    processedCount: number;
    to: number;
    nextDueAt: Date;
  },
): Promise<void> {
  await journal?.audit.recordInTransaction(tx, journal.context, {
    eventType: "rotation.completed",
    outcome: "success",
    objectKind: `rotation:${input.kind}`,
    objectId: input.operationId,
    metadata: {
      processedCount: input.processedCount,
      to: input.to,
      // Recorded because completing a rotation moves the next deadline, and an
      // operator reading the trail later needs to see when that happened
      // rather than infer it from the policy row as it stands now.
      nextDueAt: input.nextDueAt.toISOString(),
    },
  });
}

export async function auditRotationFailed(
  journal: RotationAudit,
  tx: Transaction,
  input: {
    kind: "wrapping-key" | "data-key";
    operationId: string;
    processedCount: number;
    reason: string;
  },
): Promise<void> {
  await journal?.audit.recordInTransaction(tx, journal.context, {
    eventType: "rotation.failed",
    outcome: "failure",
    objectKind: `rotation:${input.kind}`,
    objectId: input.operationId,
    metadata: {
      processedCount: input.processedCount,
      // How far it got, and why it stopped. The reason comes from messages
      // this codebase writes, which are built to name a state rather than
      // quote a value.
      reason: input.reason,
      // Stated in the row itself: the next operator to read this needs to know
      // whether they are looking at a recoverable interruption or a disaster.
      resumable: true,
    },
  });
}

export async function auditGenerationCreated(
  journal: RotationAudit,
  tx: Transaction,
  input: { generation: number; retired: number },
): Promise<void> {
  await journal?.audit.recordInTransaction(tx, journal.context, {
    eventType: "key.generation-created",
    outcome: "success",
    objectKind: "data-key-generation",
    objectId: String(input.generation),
    metadata: { generation: input.generation },
  });
  // Two rows, not one with both numbers. Retiring a generation is its own
  // event with its own consequences — every record still under it is now under
  // a decrypt-only key — and an operator searching for what happened to
  // generation N must find it under N, not buried in the row for N+1.
  await journal?.audit.recordInTransaction(tx, journal.context, {
    eventType: "key.generation-retired",
    outcome: "success",
    objectKind: "data-key-generation",
    objectId: String(input.retired),
    metadata: { generation: input.retired, state: "decrypt-only" },
  });
}
