/**
 * Synchronization follows the current trust grant (T070, US3, FR-009).
 *
 * The point being tested is timing as much as logic: revoking a device has to
 * take effect on the **next request**, not at the next key rotation. A decision
 * cached from when the device first connected would make the owner's action
 * advisory.
 *
 * The refusal reason is separated from the refusal itself on purpose. The
 * reason is for the server log; a caller must not be able to tell "no such
 * device" from "revoked" by what it receives, or the endpoint enumerates
 * device ids.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createInstallation,
  requireDeviceReauthorization,
  revokeDevice,
} from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { authorizeSynchronization } from "../src/security/synchronization-authorization.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let keyDirectory: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";

beforeAll(async () => {
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-sync-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  await harness.built.database.db.execute(sql`
    TRUNCATE authorized_devices, sessions, owners, installations CASCADE
  `);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await harness.built.database.db.execute(
    sql`INSERT INTO owners (id, installation_id, state) VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')`,
  );
});

async function authorize(state = "active"): Promise<string> {
  const id = generateUuidV7();
  // A revoked row must carry its instant: the schema refuses the state without
  // it, which is the right constraint — a revocation with no date could not be
  // reported to the owner or audited.
  const revokedAt = state === "revoked" ? new Date().toISOString() : null;
  await harness.built.database.db.execute(sql`
    INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state, revoked_at)
    VALUES (${id}::uuid, ${OWNER_ID}::uuid, ${`binding-${id}`}, 'Laptop', ${state},
            ${revokedAt}::timestamptz)
  `);
  return id;
}

describe("which devices may synchronize", () => {
  it("permits an active device", async () => {
    const id = await authorize();
    const decision = await authorizeSynchronization(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: id,
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses a revoked device on the very next request", async () => {
    const id = await authorize();
    await revokeDevice(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: id,
      now: new Date(),
    });

    const decision = await authorizeSynchronization(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toBe("device_revoked");
  });

  it("refuses a device awaiting reauthorization", async () => {
    // Precisely the case where the owner has doubts. Handing it a key would
    // make the state cosmetic.
    const id = await authorize();
    await requireDeviceReauthorization(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: id,
    });

    const decision = await authorizeSynchronization(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toBe("device_reauthorization_required");
  });

  it("refuses a device that has not confirmed itself", async () => {
    const id = await authorize("pending");
    const decision = await authorizeSynchronization(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: id,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toBe("device_pending");
  });

  it("refuses an unknown device", async () => {
    const decision = await authorizeSynchronization(harness.built.database.db, {
      ownerId: OWNER_ID,
      deviceId: generateUuidV7(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.refusal).toBe("device_unknown");
  });

  it("refuses a device that belongs to another owner", async () => {
    // Asked with a device id alone this would have succeeded. The owner is
    // part of the question even in a single-owner installation.
    const id = await authorize();
    const decision = await authorizeSynchronization(harness.built.database.db, {
      ownerId: generateUuidV7(),
      deviceId: id,
    });
    expect(decision.allowed).toBe(false);
  });

  it("refuses every non-active state, and never carries key material", async () => {
    // The decision travels to a log. It must say enough to diagnose and
    // nothing that would be unsafe to write down.
    for (const state of ["pending", "reauthorization-required", "revoked"]) {
      const id = await authorize(state);
      const decision = await authorizeSynchronization(harness.built.database.db, {
        ownerId: OWNER_ID,
        deviceId: id,
      });
      expect(decision.allowed).toBe(false);
      expect(JSON.stringify(decision)).not.toContain("binding-");
    }
  });
});
