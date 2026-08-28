/**
 * Audit service and safe problem mapping (T017, feature 002).
 *
 * Two behaviours are worth testing at this layer rather than at the repository
 * layer below it:
 *
 *   1. **The two write paths differ on purpose.** A transactional write must
 *      roll back with the operation it describes; a best-effort write must
 *      never take the request down with it. Getting those backwards produces
 *      either an audit trail that lies, or an outage caused by logging.
 *   2. **A problem body carries nothing but a code and a correlation ID.** The
 *      correlation ID is the only bridge between what the owner saw and the
 *      unredacted server log, and it is the only thing that may be specific.
 */

import { createInstallation, listAuditEvents } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { securityProblem, toSecurityProblem } from "../src/plugins/errors.ts";
import { AuditService, newCorrelationId } from "../src/security/audit-service.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let service: AuditService;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const SECRET = "s3cr3t-material-must-never-be-persisted";

const context = {
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  correlationId: "corr-1",
  actorClass: "owner" as const,
};

beforeAll(async () => {
  harness = await createApiHarness();
  service = new AuditService(harness.built.database.db);
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  const { sql } = await import("drizzle-orm");
  await harness.built.database.db.execute(
    sql`TRUNCATE security_audit_events, installations CASCADE`,
  );
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

async function events() {
  return listAuditEvents(harness.built.database.db, { installationId: INSTALLATION_ID });
}

describe("best-effort writes", () => {
  it("records an attempt with its correlation ID", async () => {
    await service.record(context, { eventType: "auth.failed", outcome: "failure" });
    const [event] = await events();
    expect(event?.eventType).toBe("auth.failed");
    expect(event?.correlationId).toBe("corr-1");
    expect(event?.actorClass).toBe("owner");
    expect(event?.workspaceId).toBe(WORKSPACE_ID);
  });

  it("carries the optional safe code, object kind, and opaque object ID", async () => {
    await service.record(context, {
      eventType: "session.revoked",
      outcome: "success",
      safeCode: "forbidden",
      objectKind: "session",
      objectId: "opaque-session-id",
    });
    const [event] = await events();
    expect(event?.safeCode).toBe("forbidden");
    expect(event?.objectKind).toBe("session");
    expect(event?.objectId).toBe("opaque-session-id");
  });

  it("omits the workspace before the promotion commits", async () => {
    // Omit the key entirely rather than setting it undefined:
    // `exactOptionalPropertyTypes` treats those as different, and the
    // pre-promotion caller genuinely has no workspace to pass.
    const { workspaceId: _omitted, ...withoutWorkspace } = context;
    await service.record(withoutWorkspace, {
      eventType: "bootstrap.started",
      outcome: "started",
    });
    const [event] = await events();
    expect(event?.workspaceId).toBeNull();
  });

  it("redacts the payload before it is persisted", async () => {
    await service.record(context, {
      eventType: "auth.failed",
      outcome: "failure",
      metadata: { password: SECRET, keyGeneration: 2 },
    });
    const [event] = await events();
    expect(event?.metadata).toEqual({ password: "[redacted]", keyGeneration: 2 });
  });

  it("never lets an audit failure take the request down", async () => {
    // A rejected event type makes the repository throw. The caller is
    // reporting something already refused; turning that into a 500 would make
    // a logging problem into an availability problem.
    const logged: unknown[] = [];
    const logging = new AuditService(harness.built.database.db, {
      logger: {
        error: (payload: unknown) => {
          logged.push(payload);
        },
      } as never,
    });
    await expect(
      logging.record(context, {
        eventType: "not.a.real.event" as never,
        outcome: "failure",
        metadata: { token: SECRET },
      }),
    ).resolves.toBeUndefined();

    expect(logged).toHaveLength(1);
    // Even the failure log is redacted.
    expect(JSON.stringify(logged[0])).not.toContain(SECRET);
    expect(await events()).toHaveLength(0);
  });

  it("logs empty redacted metadata when a failed audit has no metadata", async () => {
    const logged: unknown[] = [];
    const logging = new AuditService(harness.built.database.db, {
      logger: {
        error: (payload: unknown) => {
          logged.push(payload);
        },
      } as never,
    });

    await expect(
      logging.record(context, {
        eventType: "not.a.real.event" as never,
        outcome: "failure",
      }),
    ).resolves.toBeUndefined();

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ metadata: {} });
  });

  it("swallows the failure silently when no logger is configured", async () => {
    await expect(
      service.record(context, { eventType: "not.a.real.event" as never, outcome: "failure" }),
    ).resolves.toBeUndefined();
  });
});

describe("transactional writes", () => {
  it("commits the audit row with the operation", async () => {
    await harness.built.database.db.transaction(async (tx) => {
      await service.recordInTransaction(tx, context, {
        eventType: "bootstrap.confirmed",
        outcome: "success",
      });
    });
    expect(await events()).toHaveLength(1);
  });

  it("rolls the audit row back when the operation fails", async () => {
    // An audit trail asserting an action that then rolled back is worse than
    // no trail at all.
    await expect(
      harness.built.database.db.transaction(async (tx) => {
        await service.recordInTransaction(tx, context, {
          eventType: "bootstrap.confirmed",
          outcome: "success",
        });
        throw new Error("the operation failed after the audit write");
      }),
    ).rejects.toThrow();
    expect(await events()).toHaveLength(0);
  });

  it("propagates an audit failure instead of swallowing it", async () => {
    // Here the row must commit with the operation, so a failure has to abort
    // the operation rather than leave it unaudited.
    await expect(
      harness.built.database.db.transaction(async (tx) => {
        await service.recordInTransaction(tx, context, {
          eventType: "not.a.real.event" as never,
          outcome: "success",
        });
      }),
    ).rejects.toThrow();
  });

  it("carries every optional field through the transactional path", async () => {
    await harness.built.database.db.transaction(async (tx) => {
      await service.recordInTransaction(tx, context, {
        eventType: "rotation.completed",
        outcome: "success",
        safeCode: "conflict",
        objectKind: "rotation",
        objectId: "op-1",
        metadata: { processedCount: 10, deploymentKey: SECRET },
      });
    });
    const [event] = await events();
    expect(event?.safeCode).toBe("conflict");
    expect(event?.objectKind).toBe("rotation");
    expect(event?.objectId).toBe("op-1");
    expect(event?.metadata).toEqual({ processedCount: 10, deploymentKey: "[redacted]" });
  });
});

describe("correlation IDs", () => {
  it("produces distinct opaque identifiers", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCorrelationId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe("safe problem bodies", () => {
  it("maps each code to a stable title and status", () => {
    expect(securityProblem({ code: "authentication_failed", correlationId: "c" })).toEqual({
      type: "https://myownnotion.dev/problems/authentication_failed",
      title: "Authentication failed",
      status: 401,
      code: "authentication_failed",
      correlationId: "c",
    });
    expect(securityProblem({ code: "rate_limited", correlationId: "c" }).status).toBe(429);
    expect(securityProblem({ code: "installation_degraded", correlationId: "c" }).status).toBe(503);
    expect(securityProblem({ code: "write_blocked", correlationId: "c" }).status).toBe(409);
  });

  it("includes a detail only when the caller marked one safe", () => {
    expect(securityProblem({ code: "not_found", correlationId: "c" }).detail).toBeUndefined();
    expect(
      securityProblem({ code: "not_found", correlationId: "c", detail: "no such device" }).detail,
    ).toBe("no such device");
  });

  it("collapses an unrecognised error to internal_error with no detail", () => {
    const problem = toSecurityProblem(new Error(SECRET), "c");
    expect(problem.code).toBe("internal_error");
    expect(problem.detail).toBeUndefined();
    expect(JSON.stringify(securityProblem(problem))).not.toContain(SECRET);
  });

  it("keeps the code a repository already decided on", () => {
    expect(toSecurityProblem({ code: "write_blocked" }, "c").code).toBe("write_blocked");
    expect(toSecurityProblem({ code: "installation_degraded" }, "c").code).toBe(
      "installation_degraded",
    );
  });

  it("refuses a code the repository invented", () => {
    // Guessing a more specific code from an unrecognised string is how
    // internal detail escapes.
    expect(toSecurityProblem({ code: "database.connection-refused" }, "c").code).toBe(
      "internal_error",
    );
  });

  it("never distinguishes credential failure modes", () => {
    for (const oracle of ["unknown_user", "wrong_password", "credential_not_found"]) {
      expect(toSecurityProblem({ code: oracle }, "c").code).toBe("internal_error");
    }
  });

  it("always carries the correlation ID", () => {
    const correlationId = generateUuidV7();
    expect(securityProblem({ code: "internal_error", correlationId }).correlationId).toBe(
      correlationId,
    );
  });
});
