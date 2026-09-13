/**
 * The key hierarchy and protected records, end to end (T055/T060, feature 002).
 *
 * These two classes are where the primitives become a system, and they are the
 * pieces whose failure modes matter most: the hierarchy decides whether a key
 * is available at all, and the record service decides what happens when the
 * answer is no.
 *
 * So the tests concentrate on refusals. A round trip proving the happy path
 * takes three lines; proving that a missing deployment key, a revoked
 * generation, a substituted row, and a tampered ciphertext all *refuse* — and
 * that none of them quietly returns partial data — is what the module is for.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDatabase,
  createInstallation,
  type DatabaseHandle,
  findCurrentGeneration,
  insertGeneration,
  insertWrappingKeyVersion,
  retireGeneration,
} from "@myownnotion/database";
import { EMPTY_FILE_SHA256, type ProtectedFileManifest } from "@myownnotion/domain";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyHierarchy, KeyUnavailableError } from "../src/security/key-hierarchy.ts";
import { ProtectedContent } from "../src/security/protected-content.ts";
import { ProtectedRecordService } from "../src/security/protected-record-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;
let keyDirectory: string;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const WORKSPACE_ID = "018f2b7c-0000-7000-8000-0000000000aa";
const NOW = new Date("2026-09-01T00:00:00.000Z");
const PAYLOAD = "the combination is 19-04-77";

/** The mounted key, and a switch for taking it away mid-test. */
const key = { available: true as boolean, bytes: Buffer.alloc(32, 7) };

function hierarchy(): KeyHierarchy {
  return new KeyHierarchy({
    db: handle.db,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    deploymentKey: () => (key.available ? key.bytes : null),
    now: () => NOW,
  });
}

function records(keys: KeyHierarchy): ProtectedRecordService {
  return new ProtectedRecordService({
    db: handle.db,
    keys,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    now: () => NOW,
  });
}

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const text = (value: Uint8Array) => Buffer.from(value).toString("utf8");

beforeAll(async () => {
  postgres = await startMigratedPostgres();
  handle = createDatabase(postgres.connectionString);
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-key-"));
  writeFileSync(path.join(keyDirectory, "k"), randomBytes(32).toString("base64"));
}, 180_000);

afterAll(async () => {
  await handle?.close();
  await postgres?.stop();
  rmSync(keyDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  key.available = true;
  await handle.db.execute(sql`
    TRUNCATE protected_envelopes, data_key_generations, workspace_root_keys,
      wrapping_key_versions, installations CASCADE
  `);
  await createInstallation(handle.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

async function initialize(keys: KeyHierarchy): Promise<void> {
  await handle.db.transaction(async (tx) => {
    await keys.initialize(tx);
  });
}

describe("protected file purpose boundaries", () => {
  it("keeps lookup private and stable across both rotation kinds without exporting recovery material", async () => {
    const keys = hierarchy();
    await initialize(keys);
    const exportSpy = vi
      .spyOn(keys, "exportRecoveryMaterial")
      .mockRejectedValue(new Error("recovery only"));
    const digest = Buffer.alloc(32, 5);
    const first = await keys.fileContentLookupTag(handle.db, digest, 100);
    expect(first).toHaveLength(32);
    expect(Buffer.from(first).equals(digest)).toBe(false);
    expect(await keys.fileContentLookupTag(handle.db, digest, 101)).not.toEqual(first);
    expect(await keys.fileContentLookupTag(handle.db, Buffer.alloc(32, 6), 100)).not.toEqual(first);
    await handle.db.transaction((tx) => keys.startNextGeneration(tx));
    expect(await keys.fileContentLookupTag(handle.db, digest, 100)).toEqual(first);
    const replacement = Buffer.alloc(32, 9);
    await handle.db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE wrapping_key_versions SET state = 'previous' WHERE state = 'current'`,
      );
      const version = await insertWrappingKeyVersion(tx, {
        id: randomUUID(),
        installationId: INSTALLATION_ID,
        version: 2,
        externalSecretReference: "mounted:replacement",
        algorithm: "AES-256-GCM",
        createdAt: NOW,
      });
      await keys.rewrapRootKey(tx, {
        newWrappingKey: replacement,
        newWrappingKeyVersionId: version.id,
      });
    });
    const reopened = new KeyHierarchy({
      db: handle.db,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      deploymentKey: () => replacement,
      now: () => NOW,
    });
    expect(await reopened.fileContentLookupTag(handle.db, digest, 100)).toEqual(first);
    expect(exportSpy).not.toHaveBeenCalled();
    exportSpy.mockRestore();
  });

  it("refuses invalid lookup identities and unavailable deployment material", async () => {
    const keys = hierarchy();
    await initialize(keys);
    for (const size of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(keys.fileContentLookupTag(handle.db, Buffer.alloc(32), size)).rejects.toThrow();
    await expect(keys.fileContentLookupTag(handle.db, Buffer.alloc(31), 0)).rejects.toThrow();
    key.available = false;
    await expect(keys.fileContentLookupTag(handle.db, Buffer.alloc(32), 0)).rejects.toBeInstanceOf(
      KeyUnavailableError,
    );
  });

  it("authenticates completed and upload inventories under distinct identities", async () => {
    const keys = hierarchy();
    await initialize(keys);
    const protection = new ProtectedContent({ records: records(keys) });
    const manifest: ProtectedFileManifest = {
      format: "myownnotion.protected-file",
      formatVersion: 1,
      kind: "content",
      id: randomUUID(),
      recordVersion: 1,
      byteLength: 0,
      sha256: EMPTY_FILE_SHA256,
      chunks: [],
    };
    expect(await protection.readFileManifest(handle.db, manifest)).toBeNull();
    await protection.writeFileManifest(handle.db, manifest);
    expect(await protection.readFileManifest(handle.db, manifest)).toEqual(manifest);
    const upload: ProtectedFileManifest = {
      ...manifest,
      kind: "upload",
      declaredLength: 123,
      sha256: null,
    };
    expect(await protection.readFileManifest(handle.db, upload)).toBeNull();
    await protection.writeFileManifest(handle.db, upload);
    expect(await protection.readFileManifest(handle.db, upload)).toEqual(upload);
    expect(
      await protection.readFileManifest(handle.db, { ...manifest, recordVersion: 2 }),
    ).toBeNull();
    await records(keys).write(handle.db, {
      entityType: "file.content-manifest",
      entityId: manifest.id,
      recordVersion: 2,
      payload: bytes(JSON.stringify(manifest)),
    });
    await expect(
      protection.readFileManifest(handle.db, { ...manifest, recordVersion: 2 }),
    ).rejects.toThrow();
    await handle.db.execute(
      sql`UPDATE protected_envelopes SET entity_id = ${randomUUID()} WHERE entity_type = 'file.content-manifest'`,
    );
    expect(await protection.readFileManifest(handle.db, manifest)).toBeNull();
    await expect(
      protection.writeFileManifest(handle.db, { ...manifest, byteLength: 1 }),
    ).rejects.toThrow();
  });

  it("encrypts file and upload metadata separately and refuses malformed authenticated metadata", async () => {
    const keys = hierarchy();
    await initialize(keys);
    const recordService = records(keys);
    const protection = new ProtectedContent({ records: recordService });
    const metadata = { originalName: "Private medical journal.pdf", mediaType: "application/pdf" };
    const id = randomUUID();
    expect(await protection.readFileMetadata(handle.db, { kind: "file", id })).toBeNull();
    await protection.writeFileMetadata(handle.db, { kind: "file", id, recordVersion: 1, metadata });
    expect(await protection.readFileMetadata(handle.db, { kind: "file", id })).toEqual(metadata);
    expect(await protection.readFileMetadata(handle.db, { kind: "upload", id })).toBeNull();
    await protection.writeFileMetadata(handle.db, {
      kind: "upload",
      id,
      recordVersion: 1,
      metadata,
    });
    expect(
      await protection.readFileMetadata(handle.db, { kind: "upload", id, recordVersion: 1 }),
    ).toEqual(metadata);
    const rows = await handle.db.execute(sql`SELECT * FROM protected_envelopes`);
    expect(JSON.stringify(rows.rows)).not.toContain(metadata.originalName);
    expect(JSON.stringify(rows.rows)).not.toContain(metadata.mediaType);
    await recordService.write(handle.db, {
      entityType: "file.metadata",
      entityId: id,
      recordVersion: 2,
      payload: bytes('{"originalName":false}'),
    });
    await expect(protection.readFileMetadata(handle.db, { kind: "file", id })).rejects.toThrow(
      "Invalid protected file metadata",
    );
  });
});

describe("establishing the hierarchy", () => {
  it("creates a wrapping version, a root key, and a first generation", async () => {
    await initialize(hierarchy());
    const generation = await findCurrentGeneration(handle.db, WORKSPACE_ID);
    expect(generation?.generation).toBe(1);
    expect(generation?.state).toBe("current");
  });

  it("stores no unwrapped key material anywhere", async () => {
    // The property the whole hierarchy exists for: a dump of this database
    // must not contain anything that decrypts it.
    await initialize(hierarchy());
    const rows = await handle.db.execute(
      sql`SELECT * FROM workspace_root_keys, data_key_generations, wrapping_key_versions`,
    );
    const raw = JSON.stringify((rows as unknown as { rows: unknown[] }).rows);
    expect(raw).not.toContain(key.bytes.toString("base64"));
    expect(raw).not.toContain(key.bytes.toString("base64url"));
    // The wrapping version names a reference, not a secret.
    expect(raw).toContain("mounted:deployment-key");
  });

  it("is idempotent", async () => {
    // Two processes starting at once must not mint two root keys: records
    // written under one would be unreadable under the other.
    await initialize(hierarchy());
    await initialize(hierarchy());
    const roots = await handle.db.execute(
      sql`SELECT id FROM workspace_root_keys WHERE state = 'active'`,
    );
    expect((roots as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("refuses without the deployment key", async () => {
    key.available = false;
    await expect(initialize(hierarchy())).rejects.toBeInstanceOf(KeyUnavailableError);
    const roots = await handle.db.execute(sql`SELECT id FROM workspace_root_keys`);
    expect((roots as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
});

describe("protected records", () => {
  it("seals and opens a payload", async () => {
    const keys = hierarchy();
    await initialize(keys);
    const service = records(keys);
    await service.write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes(PAYLOAD),
    });
    const opened = await service.read(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
    });
    expect(text(opened ?? new Uint8Array())).toBe(PAYLOAD);
  });

  it("drops cached material when a restored database reuses the generation number", async () => {
    const warmKeys = hierarchy();
    await initialize(warmKeys);
    await records(warmKeys).write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes("before restore"),
    });

    // Model an operator replacing the persistent state while the API process
    // stays alive. The replacement starts again at generation 1, but it owns a
    // different root key and data key.
    await handle.db.execute(sql`
      TRUNCATE protected_envelopes, data_key_generations, workspace_root_keys,
        wrapping_key_versions CASCADE
    `);
    await initialize(warmKeys);
    await records(warmKeys).write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e2",
      recordVersion: 1,
      payload: bytes("after restore"),
    });

    // A second process has no cache. If the warm process had reused the first
    // generation's bytes, this read would fail authentication permanently.
    const opened = await records(hierarchy()).read(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e2",
    });
    expect(text(opened ?? new Uint8Array())).toBe("after restore");
  });

  it("returns null for a record that was never written", async () => {
    const keys = hierarchy();
    await initialize(keys);
    expect(
      await records(keys).read(handle.db, {
        entityType: "page.body",
        entityId: "018f2b7c-0000-7000-8000-0000000000ff",
      }),
    ).toBeNull();
  });

  it("reads many at once", async () => {
    const keys = hierarchy();
    await initialize(keys);
    const service = records(keys);
    for (let index = 1; index <= 3; index += 1) {
      await service.write(handle.db, {
        entityType: "page.body",
        entityId: `018f2b7c-0000-7000-8000-00000000000${index}`,
        recordVersion: 1,
        payload: bytes(`body ${index}`),
      });
    }
    const opened = await service.readMany(handle.db, {
      entityType: "page.body",
      entityIds: [
        "018f2b7c-0000-7000-8000-000000000001",
        "018f2b7c-0000-7000-8000-000000000002",
        "018f2b7c-0000-7000-8000-000000000003",
      ],
    });
    expect(opened.size).toBe(3);
    expect(text(opened.get("018f2b7c-0000-7000-8000-000000000002") ?? new Uint8Array())).toBe(
      "body 2",
    );
  });

  it("omits absent records from a batch rather than mapping them to null", async () => {
    // A caller iterating the map must not mistake "not protected yet" for
    // "empty content".
    const keys = hierarchy();
    await initialize(keys);
    const opened = await records(keys).readMany(handle.db, {
      entityType: "page.body",
      entityIds: ["018f2b7c-0000-7000-8000-0000000000ee"],
    });
    expect(opened.size).toBe(0);
  });
});

describe("refusals", () => {
  it("refuses to read once the deployment key is gone", async () => {
    // Losing the mounted secret must make protected data unavailable, not
    // degrade to something readable.
    const keys = hierarchy();
    await initialize(keys);
    const service = records(keys);
    await service.write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes(PAYLOAD),
    });

    // A fresh hierarchy, so nothing is served from the in-memory cache.
    key.available = false;
    const cold = hierarchy();
    await expect(
      records(cold).read(handle.db, {
        entityType: "page.body",
        entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      }),
    ).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it("refuses to read under a revoked generation", async () => {
    // Revocation is meant to make those records unreadable. Softening it for
    // reads would make the control decorative.
    const keys = hierarchy();
    await initialize(keys);
    await records(keys).write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes(PAYLOAD),
    });
    await handle.db.execute(sql`UPDATE data_key_generations SET state = 'revoked'`);

    const cold = hierarchy();
    await expect(
      records(cold).read(handle.db, {
        entityType: "page.body",
        entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      }),
    ).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it("still reads under a retired generation", async () => {
    // The other side of the same coin: `decrypt-only` exists so a rotation
    // does not destroy what came before it.
    const keys = hierarchy();
    await initialize(keys);
    await records(keys).write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes(PAYLOAD),
    });
    await handle.db.transaction(async (tx) => {
      await retireGeneration(tx, WORKSPACE_ID, 1);
    });

    const cold = hierarchy();
    const opened = await records(cold).read(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
    });
    expect(text(opened ?? new Uint8Array())).toBe(PAYLOAD);
  });

  it("refuses to write under a retired generation", async () => {
    // A write there would be a record a completed rotation had already passed
    // over, left behind a key the rotation was meant to stop using.
    const keys = hierarchy();
    await initialize(keys);
    await handle.db.transaction(async (tx) => {
      await retireGeneration(tx, WORKSPACE_ID, 1);
    });
    await expect(
      records(hierarchy()).write(handle.db, {
        entityType: "page.body",
        entityId: "018f2b7c-0000-7000-8000-0000000000e2",
        recordVersion: 1,
        payload: bytes(PAYLOAD),
      }),
    ).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it("refuses when the root key was wrapped under a different deployment key", async () => {
    // What an operator sees after mounting the wrong secret: a refusal, not a
    // crash and not plausible garbage.
    const keys = hierarchy();
    await initialize(keys);
    await records(keys).write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes(PAYLOAD),
    });

    key.bytes = Buffer.alloc(32, 9);
    const cold = hierarchy();
    await expect(
      records(cold).read(handle.db, {
        entityType: "page.body",
        entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      }),
    ).rejects.toBeInstanceOf(KeyUnavailableError);
    key.bytes = Buffer.alloc(32, 7);
  });

  it("refuses a row substituted from another entity", async () => {
    const keys = hierarchy();
    await initialize(keys);
    const service = records(keys);
    await service.write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e1",
      recordVersion: 1,
      payload: bytes("page one"),
    });
    await service.write(handle.db, {
      entityType: "page.body",
      entityId: "018f2b7c-0000-7000-8000-0000000000e2",
      recordVersion: 1,
      payload: bytes("page two"),
    });
    await handle.db.execute(sql`
      UPDATE protected_envelopes AS target
      SET ciphertext = source.ciphertext, tag = source.tag,
          nonce = source.nonce, salt = source.salt
      FROM protected_envelopes AS source
      WHERE target.entity_id = '018f2b7c-0000-7000-8000-0000000000e2'::uuid
        AND source.entity_id = '018f2b7c-0000-7000-8000-0000000000e1'::uuid
    `);
    await expect(
      service.read(handle.db, {
        entityType: "page.body",
        entityId: "018f2b7c-0000-7000-8000-0000000000e2",
      }),
    ).rejects.toMatchObject({ code: "protected_read_failed" });
  });

  it("fails a whole batch rather than dropping the record it could not verify", async () => {
    // Returning the rest as though it were complete is the quiet failure this
    // guards against: a list that silently omits a corrupted record looks
    // exactly like a list of what exists.
    const keys = hierarchy();
    await initialize(keys);
    const service = records(keys);
    for (const suffix of ["e1", "e2"]) {
      await service.write(handle.db, {
        entityType: "page.body",
        entityId: `018f2b7c-0000-7000-8000-0000000000${suffix}`,
        recordVersion: 1,
        payload: bytes(`body ${suffix}`),
      });
    }
    await handle.db.execute(sql`
      UPDATE protected_envelopes SET ciphertext = 'dGFtcGVyZWQ'
      WHERE entity_id = '018f2b7c-0000-7000-8000-0000000000e2'::uuid
    `);
    await expect(
      service.readMany(handle.db, {
        entityType: "page.body",
        entityIds: ["018f2b7c-0000-7000-8000-0000000000e1", "018f2b7c-0000-7000-8000-0000000000e2"],
      }),
    ).rejects.toMatchObject({ code: "protected_read_failed" });
  });

  it("refuses a generation whose wrap cannot be opened", async () => {
    // A corrupted or foreign wrap is refused, not treated as absent: "there is
    // no such key" and "the key is there and unreadable" are different facts,
    // and only the second means something is wrong with the installation.
    const keys = hierarchy();
    await initialize(keys);
    // The partial index permits exactly one `current` generation, so the first
    // is retired before the second is inserted — the same sequence a rotation
    // performs.
    await handle.db.transaction(async (tx) => {
      await retireGeneration(tx, WORKSPACE_ID, 1);
      await insertGeneration(tx, {
        id: randomUUID(),
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        generation: 5,
        wrappedKeyMaterial: "not.a.valid.wrap",
        createdAt: NOW,
      });
    });
    await expect(
      hierarchy().dataKey(handle.db, { generation: 5, writable: false }),
    ).rejects.toBeInstanceOf(KeyUnavailableError);
  });

  it("refuses a generation that is not there at all", async () => {
    const keys = hierarchy();
    await initialize(keys);
    await expect(
      keys.dataKey(handle.db, { generation: 99, writable: false }),
    ).rejects.toBeInstanceOf(KeyUnavailableError);
  });
});
