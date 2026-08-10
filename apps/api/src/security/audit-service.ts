/**
 * Security audit service (T017, feature 002).
 *
 * A thin orchestration layer over `appendAuditEvent`. It exists so route
 * handlers never assemble an audit row by hand, which is where correlation IDs
 * get forgotten and raw error messages get attached.
 *
 * Two responsibilities:
 *
 *   1. **Correlation.** Every audited operation carries the request's
 *      correlation ID, so an operator can join a redacted client problem to
 *      the unredacted server log and the audit row. That ID is the only
 *      bridge between what the owner saw and what actually happened.
 *   2. **Never let auditing break the operation, and never let it lie.** A
 *      failed audit write on a *best-effort* path is logged and swallowed; on
 *      a transactional path it propagates, because there the row must commit
 *      with the operation it describes.
 */

import { randomUUID } from "node:crypto";
import {
  type AuditActorClass,
  type AuditOutcome,
  appendAuditEvent,
  type Database,
  type SecurityEventType,
  type Transaction,
} from "@myownnotion/database";
import { redact, type SafeProblemCode } from "@myownnotion/domain";
import type { FastifyBaseLogger } from "fastify";

export interface AuditContext {
  readonly installationId: string;
  readonly workspaceId?: string;
  readonly correlationId: string;
  readonly actorClass: AuditActorClass;
}

export interface RecordEventInput {
  readonly eventType: SecurityEventType;
  readonly outcome: AuditOutcome;
  readonly safeCode?: SafeProblemCode;
  readonly objectKind?: string;
  readonly objectId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface AuditServiceOptions {
  readonly logger?: FastifyBaseLogger;
}

export class AuditService {
  readonly #db: Database;
  readonly #logger: FastifyBaseLogger | undefined;

  constructor(db: Database, options: AuditServiceOptions = {}) {
    this.#db = db;
    this.#logger = options.logger;
  }

  /**
   * Writes inside the caller's transaction, so the row commits or rolls back
   * with the operation. Use this whenever the event asserts that something
   * *happened*: a confirmed bootstrap, a revoked session, a completed
   * rotation.
   */
  async recordInTransaction(
    tx: Transaction,
    context: AuditContext,
    input: RecordEventInput,
  ): Promise<void> {
    await appendAuditEvent(
      tx,
      {
        installationId: context.installationId,
        ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
      },
      {
        id: randomUUID(),
        eventType: input.eventType,
        outcome: input.outcome,
        actorClass: context.actorClass,
        correlationId: context.correlationId,
        ...(input.safeCode === undefined ? {} : { safeCode: input.safeCode }),
        ...(input.objectKind === undefined ? {} : { objectKind: input.objectKind }),
        ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      },
    );
  }

  /**
   * Best-effort write outside any transaction, for events that describe an
   * *attempt* rather than a committed change: a rate-limited request, a failed
   * authentication, a refused cookie policy.
   *
   * A failure here is logged and swallowed. Refusing to answer a request
   * because the audit row could not be written would turn a logging problem
   * into an availability problem, and these events describe things that were
   * already rejected anyway.
   */
  async record(context: AuditContext, input: RecordEventInput): Promise<void> {
    try {
      await appendAuditEvent(
        this.#db,
        {
          installationId: context.installationId,
          ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
        },
        {
          id: randomUUID(),
          eventType: input.eventType,
          outcome: input.outcome,
          actorClass: context.actorClass,
          correlationId: context.correlationId,
          ...(input.safeCode === undefined ? {} : { safeCode: input.safeCode }),
          ...(input.objectKind === undefined ? {} : { objectKind: input.objectKind }),
          ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
      );
    } catch (error) {
      // The payload is redacted before it reaches the log, for the same reason
      // it is redacted before it reaches the table.
      this.#logger?.error(
        {
          eventType: input.eventType,
          correlationId: context.correlationId,
          metadata: redact(input.metadata ?? {}),
          err: error instanceof Error ? { name: error.name, message: error.message } : undefined,
        },
        "security audit write failed",
      );
    }
  }
}

/** Correlation IDs are opaque and carry no request content. */
export function newCorrelationId(): string {
  return randomUUID();
}
