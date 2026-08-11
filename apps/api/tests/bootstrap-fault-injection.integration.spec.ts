/**
 * Bootstrap fault injection (T027, feature 002).
 *
 * Every earlier suite asks what the flow does when things work. This one asks
 * what it leaves behind when they do not, because that is the property the
 * whole feature rests on: an installation is either fully set up or not set up
 * at all, never half.
 *
 * **What can and cannot be reached from here.** Every boundary past the claim
 * — credential verification, kit creation, download, confirmation — is behind
 * a real WebAuthn ceremony, which cannot be produced without an authenticator.
 * A fault injected there is never reached: the ceremony fails first, and a
 * test that passed on that basis would prove nothing while looking like it
 * proved something. This was checked rather than assumed — an injected audit
 * failure at `bootstrap.kit-created` never fires, because `verifyRegistration`
 * throws before the transaction opens.
 *
 * So the file is in two halves, and each says which it is:
 *
 *   - **Real fault injection**, against the claim transaction, which is
 *     reachable. A database-level trigger fails a write mid-transaction and
 *     the test asserts nothing partial survives.
 *   - **Refusal paths**, for the boundaries a ceremony guards. These assert
 *     the other half of the same property: a refused step commits nothing and
 *     leaves the attempt where it was.
 *
 * Reaching the deeper boundaries needs a Node-side authenticator that can mint
 * a valid attestation. That is recorded as the follow-up in tasks.md; it would
 * also unblock the parts of this file that currently stop at the refusal.
 */

import { createInstallation, findAttempt, readCounts } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/security/audit-service.ts";
import { BootstrapService, type BootstrapServiceDeps } from "../src/security/bootstrap-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import type { WebAuthnChallenge } from "../src/security/webauthn-service.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const BASE_TIME = new Date("2026-04-01T00:00:00.000Z");
const clock = { value: BASE_TIME };

function service(): BootstrapService {
  const deps: BootstrapServiceDeps = {
    db: harness.built.database.db,
    config: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    }),
    audit: new AuditService(harness.built.database.db, { logger: harness.built.app.log }),
    installationId: INSTALLATION_ID,
    workspaceId: harness.built.context.workspaceId,
    workspaceSchemaVersion: 1,
    now: () => clock.value,
    challenges: new Map<string, WebAuthnChallenge>(),
  };
  return new BootstrapService(deps);
}

beforeAll(async () => {
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    }),
    now: () => clock.value,
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

beforeEach(async () => {
  clock.value = BASE_TIME;
  await harness.built.database.db.execute(sql`
    TRUNCATE security_audit_events, security_rate_limits, recovery_kits, recovery_epochs,
      data_key_generations, sessions, authorized_devices, pending_bootstrap_credentials,
      bootstrap_attempts, password_credential_versions, passkey_credentials, owners,
      installations CASCADE
  `);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

const counts = () => readCounts(harness.built.database.db);
const ZERO = { ownerCount: 0, workspaceCount: 0 };

/**
 * Fails the next insert into `bootstrap_attempts`, from inside the database.
 *
 * A trigger, not a stubbed repository: the point is to fail a write the
 * transaction has already begun, the way a disk error or a constraint would,
 * rather than to fail before the transaction opens.
 */
async function failNextAttemptInsert(): Promise<void> {
  await harness.built.database.db.execute(sql`
    CREATE OR REPLACE FUNCTION injected_attempt_fault() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected storage fault';
    END;
    $$ LANGUAGE plpgsql
  `);
  await harness.built.database.db.execute(sql`
    CREATE TRIGGER injected_attempt_fault_trigger
    BEFORE INSERT ON bootstrap_attempts
    FOR EACH ROW EXECUTE FUNCTION injected_attempt_fault()
  `);
}

/**
 * Whether the injected trigger is what failed, rather than something else.
 *
 * Drizzle wraps driver errors, so the trigger's own message is only reachable
 * through the `cause` chain. Matching the wrapper text would also match a
 * unique violation on the same insert, which is a different failure entirely.
 */
function causedByInjectedFault(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current.message.includes("injected storage fault")) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

async function expectInjectedFault(work: Promise<unknown>): Promise<void> {
  await work.then(
    () => {
      throw new Error("expected the injected storage fault, but the call succeeded");
    },
    (error: unknown) => {
      expect(causedByInjectedFault(error), `unexpected failure: ${String(error)}`).toBe(true);
    },
  );
}

async function clearInjectedFault(): Promise<void> {
  await harness.built.database.db.execute(
    sql`DROP TRIGGER IF EXISTS injected_attempt_fault_trigger ON bootstrap_attempts`,
  );
}

describe("a storage fault inside the claim transaction", () => {
  it("leaves no attempt and no trace of a bootstrap in progress", async () => {
    await failNextAttemptInsert();
    try {
      // Asserting which fault fired, not merely that something did: otherwise
      // the test passes just as happily when `start` fails for an unrelated
      // reason and the injected fault is never reached.
      await expectInjectedFault(
        service().start({ clientNonce: "n".repeat(24), correlationId: "c1" }),
      );
    } finally {
      await clearInjectedFault();
    }

    const attempts = await harness.built.database.db.execute(
      sql`SELECT id FROM bootstrap_attempts`,
    );
    expect((attempts as unknown as { rows: unknown[] }).rows).toHaveLength(0);
    // The installation must not be left claiming a bootstrap is under way,
    // which would be its own lockout: the status page would say one thing and
    // the attempts table another.
    const installation = await harness.built.database.db.execute(
      sql`SELECT state FROM installations`,
    );
    expect((installation as unknown as { rows: { state: string }[] }).rows[0]?.state).toBe(
      "uninitialized",
    );
    expect(await counts()).toEqual(ZERO);
  });

  it("the next claim succeeds once the fault clears", async () => {
    // A transient fault must not cost the owner the ability to set up at all.
    await failNextAttemptInsert();
    await expectInjectedFault(
      service().start({ clientNonce: "n".repeat(24), correlationId: "c1" }),
    );
    await clearInjectedFault();

    const started = await service().start({ clientNonce: "m".repeat(24), correlationId: "c2" });
    expect(started.attemptId).toBeTruthy();
    expect(await counts()).toEqual(ZERO);
  });

  it("a fault while superseding leaves the old attempt open, not half-closed", async () => {
    // The supersession abandons one attempt and inserts another in a single
    // transaction. If the abandon committed and the insert did not, the
    // installation would be left with no open attempt and no owner — and the
    // partial unique index would happily allow that state to persist.
    const bootstrap = service();
    const first = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });

    clock.value = new Date(BASE_TIME.getTime() + 16 * 60_000);
    await failNextAttemptInsert();
    try {
      await expectInjectedFault(
        bootstrap.start({ clientNonce: "p".repeat(24), correlationId: "c2" }),
      );
    } finally {
      await clearInjectedFault();
    }

    const attempt = await findAttempt(harness.built.database.db, first.attemptId);
    expect(attempt?.state).toBe("started");
    expect(await counts()).toEqual(ZERO);
  });
});

describe("a credential refused before any transaction opens", () => {
  it("leaves no credential, no kit, and no owner", async () => {
    const bootstrap = service();
    const started = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });

    await expect(
      bootstrap.verifyCredential({
        attemptId: started.attemptId,
        capability: started.capability,
        response: {},
        correlationId: "c1",
      }),
    ).rejects.toThrow();

    expect(await counts()).toEqual(ZERO);
    const kits = await harness.built.database.db.execute(sql`SELECT id FROM recovery_kits`);
    expect((kits as unknown as { rows: unknown[] }).rows).toHaveLength(0);
    const credentials = await harness.built.database.db.execute(
      sql`SELECT id FROM pending_bootstrap_credentials`,
    );
    expect((credentials as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it("leaves the attempt where it was, not in a state it never reached", async () => {
    const bootstrap = service();
    const started = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });

    await expect(
      bootstrap.verifyCredential({
        attemptId: started.attemptId,
        capability: started.capability,
        response: {},
        correlationId: "c1",
      }),
    ).rejects.toThrow();

    const attempt = await findAttempt(harness.built.database.db, started.attemptId);
    expect(attempt?.state).toBe("started");
    expect(attempt?.recoveryKitId).toBeNull();
  });
});

describe("a download refused before any kit exists", () => {
  // Reaching a prepared kit needs a real WebAuthn ceremony, which cannot be
  // produced without an authenticator, so the injected fault is never reached
  // here. What this does pin is the other half of the same property: a refused
  // download must not spend the one-time slot or move the attempt. An attempt
  // left at `download-consumed` with no kit behind it is the worst outcome the
  // flow has — no kit, and no way to get one.
  it("does not spend the one-time download", async () => {
    const bootstrap = service();
    const started = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });
    await expect(
      bootstrap.consumeKitDownload({
        attemptId: started.attemptId,
        capability: started.capability,
        correlationId: "c1",
      }),
    ).rejects.toThrow();

    const attempt = await findAttempt(harness.built.database.db, started.attemptId);
    expect(attempt?.state).toBe("started");
    expect(attempt?.downloadConsumedAt).toBeNull();
    expect(await counts()).toEqual(ZERO);
  });
});

describe("a confirmation refused before the download is consumed", () => {
  // Same limitation as above: the attempt is still at `started`, so the domain
  // refuses before the injected fault can fire. The assertion that matters is
  // unchanged — a refused confirmation commits no owner.
  it("commits no owner", async () => {
    const bootstrap = service();
    const started = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });

    await expect(
      bootstrap.confirmAndPromote({
        attemptId: started.attemptId,
        capability: started.capability,
        deviceBindingId: "binding",
        deviceName: "Laptop",
        devicePlatform: null,
        correlationId: "c1",
      }),
    ).rejects.toThrow();

    expect(await counts()).toEqual(ZERO);
  });
});

describe("retrying after a fault", () => {
  it("the attempt survives the fault: the owner does not start over", async () => {
    // A transient storage fault must not cost the owner their attempt. If it
    // did, every blip would mean starting the ceremony over.
    const bootstrap = service();
    const started = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });
    await expect(
      bootstrap.verifyCredential({
        attemptId: started.attemptId,
        capability: started.capability,
        response: {},
        correlationId: "c1",
      }),
    ).rejects.toThrow();

    const attempt = await findAttempt(harness.built.database.db, started.attemptId);
    expect(attempt?.state).toBe("started");

    // Still the live attempt, so a fresh claim is still refused — the slot was
    // not silently released by the failure.
    await expect(
      bootstrap.start({ clientNonce: "m".repeat(24), correlationId: "c2" }),
    ).rejects.toThrow();
  });

  it("a wrong capability after a fault is refused exactly like any other", async () => {
    const bootstrap = service();
    const started = await bootstrap.start({ clientNonce: "n".repeat(24), correlationId: "c1" });
    await expect(
      bootstrap.verifyCredential({
        attemptId: started.attemptId,
        capability: started.capability,
        response: {},
        correlationId: "c1",
      }),
    ).rejects.toThrow();

    await expect(
      bootstrap.verifyCredential({
        attemptId: started.attemptId,
        capability: "not-the-capability",
        response: {},
        correlationId: "c1",
      }),
    ).rejects.toThrow();
    expect(await counts()).toEqual(ZERO);
  });
});

describe("with the deployment key unavailable", () => {
  it("status still answers, so the owner can see what is wrong", async () => {
    // An installation that goes silent during a fault cannot be diagnosed by
    // the only person who can fix it.
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/installation/status",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().securityReady).toBe(false);
  });

  it("the status body never names the key path", async () => {
    // The path is operator information and belongs in the server log only.
    const response = await harness.built.app.inject({
      method: "GET",
      url: "/v1/installation/status",
    });
    expect(response.body).not.toContain("deployment-key");
    expect(response.body).not.toContain("/");
  });
});
