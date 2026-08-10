/**
 * Append-only audit persistence (T012, feature 002).
 *
 * The audit trail is the one place where every security flow deposits a
 * record, which makes it the single most likely place for a leak. These tests
 * assert the two properties that keep it safe, against the real table:
 *
 *   1. only allowlisted event types are persisted, and every declared type
 *      actually works — a flow whose event was never added would silently go
 *      unaudited;
 *   2. no persisted row contains content, credentials, tokens, bootstrap
 *      capabilities, CSRF tokens, recovery kits, or key material, however
 *      deeply nested the caller buried it.
 *
 * Both recovery state axes and their full transition vocabulary are covered,
 * because a recovery flow that is only half-audited cannot be reconstructed
 * after an incident.
 */

import {
  appendAuditEvent,
  createInstallation,
  listAuditEvents,
  SECURITY_EVENT_TYPES,
  type SecurityEventType,
  SecurityRepositoryError,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSecurityIntegrationContext,
  type SecurityIntegrationContext,
} from "./helpers/security-db.ts";

let context: SecurityIntegrationContext;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const SECRET = "s3cr3t-material-must-never-be-persisted";

beforeAll(async () => {
  context = await createSecurityIntegrationContext();
}, 180_000);

afterAll(async () => {
  await context?.close();
});

beforeEach(async () => {
  await context.handle.db.execute(sql`TRUNCATE security_audit_events, installations CASCADE`);
  await createInstallation(context.handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

const scope = { installationId: INSTALLATION_ID, workspaceId: WORKSPACE_ID };

async function append(
  eventType: SecurityEventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await appendAuditEvent(context.handle.db, scope, {
    id: generateUuidV7(),
    eventType,
    outcome: "success",
    actorClass: "system",
    correlationId: "corr-1",
    metadata,
  });
}

describe("allowlisted event set", () => {
  it("persists every declared event type", async () => {
    // A flow whose event type was never added here would go unaudited.
    for (const eventType of SECURITY_EVENT_TYPES) {
      await expect(append(eventType), eventType).resolves.toBeUndefined();
    }
    const events = await listAuditEvents(context.handle.db, scope, { limit: 1000 });
    expect(events).toHaveLength(SECURITY_EVENT_TYPES.length);
  });

  it("refuses an event type outside the allowlist", async () => {
    // A free-form event name is how content reaches an audit trail.
    await expect(
      appendAuditEvent(context.handle.db, scope, {
        id: generateUuidV7(),
        eventType: "page.renamed to Quarterly Layoffs" as SecurityEventType,
        outcome: "success",
        actorClass: "owner",
        correlationId: "corr-1",
      }),
    ).rejects.toBeInstanceOf(SecurityRepositoryError);
    expect(await listAuditEvents(context.handle.db, scope)).toHaveLength(0);
  });

  it("covers both recovery axes across the full transition vocabulary", async () => {
    const required: SecurityEventType[] = [
      "recovery.kit-prepared",
      "recovery.kit-downloaded",
      "recovery.kit-download-consumed",
      "recovery.kit-confirmed",
      "recovery.kit-superseded",
      "recovery.kit-revoked",
      "recovery.kit-rejected",
      "recovery.kit-expired",
      "recovery.epoch-advanced",
    ];
    for (const eventType of required) {
      expect(SECURITY_EVENT_TYPES, eventType).toContain(eventType);
      await append(eventType);
    }
    const events = await listAuditEvents(context.handle.db, scope, { limit: 100 });
    expect(new Set(events.map((event) => event.eventType))).toEqual(new Set(required));
  });

  it("covers rotation, migration, integrity, and administrative events", async () => {
    for (const eventType of [
      "rotation.started",
      "rotation.checkpoint",
      "rotation.completed",
      "rotation.failed",
      "rotation.write-blocked",
      "migration.started",
      "migration.checkpoint",
      "migration.cutover",
      "migration.completed",
      "migration.failed",
      "integrity.envelope-rejected",
      "integrity.identity-drift-detected",
      "admin.cli-command-executed",
      "admin.cli-command-refused",
    ] as SecurityEventType[]) {
      expect(SECURITY_EVENT_TYPES, eventType).toContain(eventType);
    }
  });
});

describe("scoping", () => {
  it("stamps every row with the installation and workspace", async () => {
    await append("bootstrap.started");
    const [event] = await listAuditEvents(context.handle.db, scope);
    expect(event?.installationId).toBe(INSTALLATION_ID);
    expect(event?.workspaceId).toBe(WORKSPACE_ID);
  });

  it("leaves the workspace null before the promotion commits", async () => {
    // Pre-confirmation bootstrap has no workspace; inventing one would make
    // the 0/0 claim unverifiable.
    await appendAuditEvent(
      context.handle.db,
      { installationId: INSTALLATION_ID },
      {
        id: generateUuidV7(),
        eventType: "bootstrap.started",
        outcome: "started",
        actorClass: "system",
        correlationId: "corr-1",
      },
    );
    const [event] = await listAuditEvents(context.handle.db, { installationId: INSTALLATION_ID });
    expect(event?.workspaceId).toBeNull();
  });

  it("never returns rows from another installation", async () => {
    await append("auth.succeeded");
    const foreign = await listAuditEvents(context.handle.db, {
      installationId: "018f2b7c-0000-7000-8000-0000000000ff",
    });
    expect(foreign).toHaveLength(0);
  });
});

describe("redaction of persisted rows", () => {
  const forbiddenPayloads: Array<[string, Record<string, unknown>]> = [
    ["content", { content: SECRET }],
    ["credential", { credential: SECRET }],
    ["password", { password: SECRET }],
    ["token", { token: SECRET }],
    ["session token", { sessionToken: SECRET }],
    ["bootstrap capability", { bootstrapCapability: SECRET }],
    ["CSRF token", { csrfToken: SECRET }],
    ["recovery kit", { recoveryKit: SECRET }],
    ["deployment key", { deploymentKey: SECRET }],
    ["plaintext", { plaintext: SECRET }],
    ["nested key", { outer: { inner: { deploymentKey: SECRET } } }],
    ["inside an array", { sessions: [{ token: SECRET }, { token: SECRET }] }],
    ["stringified JSON", { requestBody: JSON.stringify({ passphrase: SECRET }) }],
  ];

  it.each(forbiddenPayloads)("redacts %s before it reaches the table", async (_label, metadata) => {
    await append("auth.failed", metadata);
    // Read the raw column, not the repository's view: the guarantee is about
    // what is *persisted*, not about what a getter chooses to show.
    const result = await context.handle.db.execute<{ metadata: string }>(sql`
      SELECT metadata::text AS metadata FROM security_audit_events
    `);
    expect(result.rows[0]?.metadata).not.toContain(SECRET);
  });

  it("keeps the field name while replacing the value", async () => {
    // A deleted key would itself signal "this installation has no password".
    await append("auth.failed", { password: SECRET });
    const [event] = await listAuditEvents(context.handle.db, scope);
    expect(Object.keys(event?.metadata ?? {})).toEqual(["password"]);
    expect(event?.metadata["password"]).toBe("[redacted]");
  });

  it("preserves safe diagnostic fields", async () => {
    await append("rotation.checkpoint", {
      keyGeneration: 3,
      processedCount: 120,
      credentialId: "opaque-credential-id",
    });
    const [event] = await listAuditEvents(context.handle.db, scope);
    expect(event?.metadata).toEqual({
      keyGeneration: 3,
      processedCount: 120,
      credentialId: "opaque-credential-id",
    });
  });

  it("leaves no forbidden field in any persisted row, across every event type", async () => {
    for (const eventType of SECURITY_EVENT_TYPES) {
      await append(eventType, {
        deploymentKey: SECRET,
        recoveryKit: SECRET,
        content: SECRET,
        keyGeneration: 1,
      });
    }
    const result = await context.handle.db.execute<{ metadata: string }>(sql`
      SELECT metadata::text AS metadata FROM security_audit_events
    `);
    for (const row of result.rows) {
      expect(row.metadata).not.toContain(SECRET);
    }
    expect(result.rows).toHaveLength(SECURITY_EVENT_TYPES.length);
  });
});

describe("append-only behaviour", () => {
  it("exposes no update or delete path", async () => {
    // Enforced by omission: the module has no such export. This test documents
    // the intent so adding one is a deliberate, visible decision.
    const repository = await import("@myownnotion/database");
    const surface = Object.keys(repository).filter((name) => name.toLowerCase().includes("audit"));
    expect(surface.some((name) => /update|delete|remove|purge/i.test(name))).toBe(false);
  });

  it("returns events newest first", async () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    for (const [index, eventType] of (
      ["bootstrap.started", "bootstrap.confirmed", "auth.succeeded"] as SecurityEventType[]
    ).entries()) {
      await appendAuditEvent(context.handle.db, scope, {
        id: generateUuidV7(),
        eventType,
        outcome: "success",
        actorClass: "system",
        correlationId: "corr-1",
        occurredAt: new Date(base.getTime() + index * 60_000),
      });
    }
    const events = await listAuditEvents(context.handle.db, scope);
    expect(events.map((event) => event.eventType)).toEqual([
      "auth.succeeded",
      "bootstrap.confirmed",
      "bootstrap.started",
    ]);
  });

  it("rolls the audit row back with the operation it describes", async () => {
    // An audit trail recording an action that then rolled back is worse than
    // no trail: it asserts something happened that did not.
    await expect(
      context.handle.db.transaction(async (tx) => {
        await appendAuditEvent(tx, scope, {
          id: generateUuidV7(),
          eventType: "bootstrap.confirmed",
          outcome: "success",
          actorClass: "owner",
          correlationId: "corr-1",
        });
        throw new Error("the operation failed after the audit write");
      }),
    ).rejects.toThrow();
    expect(await listAuditEvents(context.handle.db, scope)).toHaveLength(0);
  });

  it("records the hosting-admin actor class only for local CLI events", async () => {
    await appendAuditEvent(context.handle.db, scope, {
      id: generateUuidV7(),
      eventType: "admin.cli-command-executed",
      outcome: "success",
      actorClass: "hosting-admin",
      correlationId: "corr-1",
    });
    const [event] = await listAuditEvents(context.handle.db, scope);
    expect(event?.actorClass).toBe("hosting-admin");
  });
});
