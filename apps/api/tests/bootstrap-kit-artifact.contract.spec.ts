/**
 * The kit an owner downloads during setup (T059, US4, FR-015, FR-016).
 *
 * This file exists because the thing it tests was, until now, a lie.
 *
 * The bootstrap ceremony was complete and correct — one-time download,
 * explicit confirmation, states advancing properly — around an artifact that
 * carried a format name, a version, an id, and **no encrypted material at
 * all**. An owner who followed every instruction, stored the file carefully,
 * and later needed it would have found that it recovered nothing.
 *
 * So the assertions are about what the file contains, and about what happens
 * when it cannot be built: a placeholder emitted because the key was missing is
 * worse than an error, because an error is visible now and a placeholder is
 * invisible until it matters.
 */

import { randomBytes } from "node:crypto";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  schema,
} from "@myownnotion/database";
import { openRecoveryKit } from "@myownnotion/domain/security";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BootstrapKitUnavailableError, renderBootstrapKit } from "../src/security/bootstrap-kit.ts";
import { KeyHierarchy } from "../src/security/key-hierarchy.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const KIT_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const KEY = Buffer.from(randomBytes(32));

function hierarchy(): KeyHierarchy {
  return new KeyHierarchy({
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => KEY,
    now: () => new Date(),
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    keys: hierarchy(),
    deploymentKey: () => KEY as Buffer | null,
    now: () => new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
});

beforeEach(async () => {
  await handle.db.execute(sql`
    TRUNCATE data_key_generations, workspace_root_keys, wrapping_key_versions,
      installations CASCADE
  `);
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
  await handle.db.transaction(async (tx) => {
    await hierarchy().initialize(tx);
  });
});

describe("what the artifact holds", () => {
  it("seals material that opens under the deployment key", async () => {
    const artifact = await renderBootstrapKit(deps(), KIT_ID);

    // The property the placeholder could never have had, and the only one that
    // makes the file worth the ceremony around it.
    expect(artifact.encryption.ciphertext.length).toBeGreaterThan(0);
    const opened = openRecoveryKit(
      { ...artifact, authorizationState: "active", deliveryState: "confirmed" },
      { kind: "deployment-key", deploymentKey: new Uint8Array(KEY) },
    );
    expect(opened.length).toBe(32);
  });

  it("holds the workspace root key, so a restore can read the workspace", async () => {
    const artifact = await renderBootstrapKit(deps(), KIT_ID);
    const opened = openRecoveryKit(
      { ...artifact, authorizationState: "active", deliveryState: "confirmed" },
      { kind: "deployment-key", deploymentKey: new Uint8Array(KEY) },
    );

    // Every data key is sealed under this one, and every record under those.
    // A kit holding anything else would restore a machine that still cannot
    // read its own notes.
    expect(opened).toEqual(await hierarchy().exportRecoveryMaterial(handle.db));
  });

  it("carries the metadata a restore needs to identify itself", async () => {
    const artifact = await renderBootstrapKit(deps(), KIT_ID);

    // Lineage, epoch, and the generations a restored installation must open.
    // Without them a kit restores key material into a machine that cannot tell
    // whether it is the right one.
    expect(artifact.sourceLineageId).toBe(WORKSPACE_ID);
    expect(artifact.recoveryEpoch).toBe(1);
    expect(artifact.supportedKeyGenerations).toEqual([1]);
    expect(artifact.kitId).toBe(KIT_ID);
  });

  it("says it needs the deployment key rather than a passphrase", async () => {
    const artifact = await renderBootstrapKit(deps(), KIT_ID);
    // Whoever holds this file must be able to tell what opens it without
    // running code that guesses.
    expect(artifact.kdf.algorithm).toBe("deployment-key");
  });

  it("names every generation the workspace has used", async () => {
    await handle.db.transaction(async (tx) => {
      await hierarchy().startNextGeneration(tx);
    });

    const artifact = await renderBootstrapKit(deps(), KIT_ID);
    // Read rather than assumed. A kit issued after a data-key rotation must
    // still open records written under the generation before it.
    expect(artifact.supportedKeyGenerations).toEqual([1, 2]);
  });
});

describe("when it cannot be built", () => {
  it("refuses rather than emitting a placeholder without the key", async () => {
    // The failure that produced the original stub. A placeholder is worse than
    // an error: the error is visible now, the placeholder only at the moment
    // it is needed.
    await expect(renderBootstrapKit(deps({ deploymentKey: () => null }), KIT_ID)).rejects.toThrow(
      BootstrapKitUnavailableError,
    );
  });

  it("refuses without a key hierarchy", async () => {
    await expect(renderBootstrapKit(deps({ keys: undefined }), KIT_ID)).rejects.toThrow(
      BootstrapKitUnavailableError,
    );
  });
});

describe("what is stored about it", () => {
  it("keeps a digest and never the ciphertext", async () => {
    // The row exists so an operator can tell whether the file an owner
    // produces is the one this installation issued. Storing the ciphertext
    // would put the thing being protected in the database it is meant to
    // survive.
    const columns = await handle.db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'recovery_kits'`,
    );
    const serialized = JSON.stringify(columns);
    expect(serialized).toContain("artifact_digest");
    expect(serialized).not.toContain("ciphertext");
    void schema;
  });
});

describe("the first data key", () => {
  it("is sealed under the root key rather than being random bytes", async () => {
    // This was `newSecret()` until T059: random bytes stored where a wrapped
    // key belongs, which meant generation 1 — the generation every subsequent
    // protected write depends on — could never be unwrapped.
    await handle.db.execute(sql`TRUNCATE data_key_generations CASCADE`);
    const keys = hierarchy();
    const wrapped = await handle.db.transaction(async (tx) => await keys.sealFirstDataKey(tx));

    // Three base64url parts: nonce, ciphertext, tag. Random bytes would be one.
    expect(wrapped.split(".")).toHaveLength(3);
  });

  it("produces a generation the hierarchy can open", async () => {
    await handle.db.execute(sql`TRUNCATE data_key_generations CASCADE`);
    const keys = hierarchy();
    const wrapped = await handle.db.transaction(async (tx) => await keys.sealFirstDataKey(tx));
    await handle.db.insert(schema.dataKeyGenerations).values({
      id: "018f2b7c-0000-7000-8000-0000000000cc",
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      generation: 1,
      wrappedKeyMaterial: wrapped,
      state: "current",
    });

    // The property that was silently false after every bootstrap: the workspace
    // can actually read itself.
    const dataKey = await keys.dataKey(handle.db, { writable: true });
    expect(dataKey.generation).toBe(1);
    expect(dataKey.material.length).toBe(32);
  });
});

describe("establishing the root key without a generation", () => {
  it("leaves the promotion free to insert generation one", async () => {
    // The collision this separation exists to avoid: eagerly initialising the
    // full hierarchy is exactly what broke setup once already, because the
    // promotion's own insert then violated the partial unique index.
    await handle.db.execute(
      sql`TRUNCATE data_key_generations, workspace_root_keys, wrapping_key_versions CASCADE`,
    );
    await handle.db.transaction(async (tx) => {
      await hierarchy().ensureRootKey(tx);
    });

    expect(await handle.db.select().from(schema.workspaceRootKeys)).toHaveLength(1);
    expect(await handle.db.select().from(schema.dataKeyGenerations)).toHaveLength(0);
  });

  it("is idempotent", async () => {
    await handle.db.transaction(async (tx) => {
      await hierarchy().ensureRootKey(tx);
    });
    await handle.db.transaction(async (tx) => {
      await hierarchy().ensureRootKey(tx);
    });
    // Two root keys would mean records written under one are unreadable under
    // the other, which no amount of careful calling prevents — only the index
    // and this check do.
    expect(await handle.db.select().from(schema.workspaceRootKeys)).toHaveLength(1);
  });
});
