/**
 * Every way a recovery kit is refused (T078, US5, FR-016, FR-018, FR-019, SC-005).
 *
 * The replacement and import tests next door prove the paths that work. This
 * file is about the ones that must not, and they are worth their own file
 * because they share a shape: **each is a kit that looks entirely plausible.**
 *
 * A kit from an earlier epoch, a kit from a sibling installation, a kit whose
 * ciphertext was edited by one byte — all of them are valid JSON, carry the
 * right format marker, name a real installation, and would restore *something*
 * if the refusal were missing. The failure mode is never a crash. It is an
 * operator concluding a restore succeeded.
 *
 * Every refusal here also fails the same way, deliberately. A message that
 * distinguished "wrong epoch" from "wrong lineage" from "tampered" would tell
 * someone holding a stolen kit which part to fix.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase, type DatabaseHandle, schema } from "@myownnotion/database";
import { createRecoveryKit, type RecoveryKit } from "@myownnotion/domain/security";
import { type DisposablePostgres, startMigratedPostgres } from "@myownnotion/test-utils";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdministrativeRecoveryService } from "../src/security/administrative-recovery-service.ts";

let postgres: DisposablePostgres;
let handle: DatabaseHandle;

const INSTALLATION = "018f2b7c-0000-7000-8000-0000000000d1";
const LINEAGE = "018f2b7c-0000-7000-8000-0000000000d2";
const KEY = Buffer.from(randomBytes(32));
const ROOT_KEY = new Uint8Array(randomBytes(32));

function service(): AdministrativeRecoveryService {
  return new AdministrativeRecoveryService({
    db: handle.db,
    deploymentKey: () => KEY,
    now: () => new Date(),
  });
}

function makeKit(overrides: Record<string, unknown> = {}): RecoveryKit {
  return createRecoveryKit({
    installationId: INSTALLATION,
    sourceLineageId: LINEAGE,
    kitId: randomUUID(),
    recoveryEpoch: 4,
    secret: { kind: "deployment-key", deploymentKey: new Uint8Array(KEY) },
    payload: ROOT_KEY,
    supportedKeyGenerations: [1],
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
    downloadExpiresAt: new Date("2026-05-01T00:15:00.000Z"),
    ...overrides,
  });
}

/** Collects the message of a refusal, or fails loudly if there was none. */
async function refusalOf(kit: RecoveryKit): Promise<string> {
  try {
    await service().import(kit);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the import was accepted when it should have been refused");
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
    TRUNCATE protected_envelopes, items, authorized_devices, data_key_generations,
      workspace_root_keys, wrapping_key_versions, recovery_kits, recovery_epochs,
      owners, installations, workspaces CASCADE
  `);
});

describe("a kit bound to a different epoch", () => {
  it("is refused", async () => {
    const kit = makeKit();
    // The epoch is part of the AAD, so changing it makes the ciphertext fail
    // its tag check. That is the mechanism; the property is that an epoch the
    // installation has moved past cannot be replayed.
    const replayed = { ...kit, recoveryEpoch: kit.recoveryEpoch - 1 };
    expect(await refusalOf(replayed)).toMatch(/does not open/i);
  });

  it("leaves the target untouched", async () => {
    await refusalOf({ ...makeKit(), recoveryEpoch: 1 });
    expect(await handle.db.select().from(schema.installations)).toHaveLength(0);
  });
});

describe("a kit from another lineage", () => {
  it("is refused even though it opens under the same deployment key", async () => {
    const kit = makeKit();
    // Two installations on one host share a deployment key. Without the
    // lineage in the AAD, either kit would restore into either target — and an
    // operator would have no way to tell which workspace they had just
    // resurrected.
    const sibling = { ...kit, sourceLineageId: "018f2b7c-0000-7000-8000-0000000000ff" };
    expect(await refusalOf(sibling)).toMatch(/does not open/i);
  });

  it("is refused when the installation id is swapped", async () => {
    const kit = makeKit();
    const swapped = { ...kit, installationId: "018f2b7c-0000-7000-8000-0000000000fe" };
    expect(await refusalOf(swapped)).toMatch(/does not open/i);
  });
});

describe("a tampered kit", () => {
  it("is refused when one byte of ciphertext changes", async () => {
    const kit = makeKit();
    const flipped = flipOneCharacter(kit.encryption.ciphertext);
    expect(
      await refusalOf({ ...kit, encryption: { ...kit.encryption, ciphertext: flipped } }),
    ).toMatch(/does not open/i);
  });

  it("is refused when the tag is replaced", async () => {
    const kit = makeKit();
    expect(
      await refusalOf({
        ...kit,
        encryption: { ...kit.encryption, tag: Buffer.alloc(16).toString("base64url") },
      }),
    ).toMatch(/does not open/i);
  });

  it("is refused when the salt is changed", async () => {
    // The salt derives the wrapping key. Changing it derives a different key,
    // which is a refusal rather than a wrong answer — and that difference is
    // the whole reason the derivation is authenticated.
    const kit = makeKit();
    expect(
      await refusalOf({
        ...kit,
        kdf: { ...kit.kdf, salt: Buffer.alloc(16, 9).toString("base64url") },
      }),
    ).toMatch(/does not open/i);
  });
});

describe("a malformed kit", () => {
  it("is refused when the ciphertext is not decodable", async () => {
    const kit = makeKit();
    expect(
      await refusalOf({ ...kit, encryption: { ...kit.encryption, ciphertext: "not base64!!" } }),
    ).toMatch(/does not open/i);
  });

  it("is refused when the nonce is the wrong length", async () => {
    const kit = makeKit();
    expect(
      await refusalOf({
        ...kit,
        encryption: { ...kit.encryption, nonce: Buffer.alloc(4).toString("base64url") },
      }),
    ).toMatch(/does not open/i);
  });
});

describe("what every refusal has in common", () => {
  it("says the same thing whatever was wrong", async () => {
    const kit = makeKit();
    const messages = new Set<string>();
    messages.add(await refusalOf({ ...kit, recoveryEpoch: 1 }));
    messages.add(await refusalOf({ ...kit, sourceLineageId: randomUUID() }));
    messages.add(
      await refusalOf({
        ...kit,
        encryption: { ...kit.encryption, ciphertext: flipOneCharacter(kit.encryption.ciphertext) },
      }),
    );

    // One message for every failure. Distinguishing them would tell someone
    // holding a stolen kit which part to fix, and none of the distinctions
    // helps a legitimate operator: in every case the answer is the same, which
    // is that this kit does not belong to this target.
    expect(messages.size).toBe(1);
  });

  it("never quotes any part of the kit back", async () => {
    const kit = makeKit();
    const message = await refusalOf({ ...kit, recoveryEpoch: 1 });
    expect(message).not.toContain(kit.encryption.ciphertext);
    expect(message).not.toContain(kit.kdf.salt);
    expect(message).not.toContain(KEY.toString("base64"));
  });
});

/** Changes exactly one character, which is enough to fail an AEAD tag. */
function flipOneCharacter(encoded: string): string {
  const first = encoded[0] ?? "A";
  const replacement = first === "A" ? "B" : "A";
  return `${replacement}${encoded.slice(1)}`;
}
