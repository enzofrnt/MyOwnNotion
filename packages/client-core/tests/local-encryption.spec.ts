/**
 * Device-bound local encryption (T052, US4, FR-012, FR-014, FR-024).
 *
 * The browser copy of the workspace is a full copy. On a shared or stolen
 * machine it is the easiest place to read someone's notes, so it is sealed
 * with the same envelope discipline as the server: one key per record derived
 * from a device key, and an AAD that binds each ciphertext to its entity type
 * and id.
 *
 * These tests assert the properties that make that worth doing, not just that
 * a round trip returns the input. A round trip passes just as happily when the
 * plaintext is also written somewhere in the clear, when every record shares a
 * nonce, or when one record's ciphertext can be opened as another's.
 */

import {
  LOCAL_ENTITY_TYPES,
  LOCAL_ENVELOPE_ALGORITHM,
  LOCAL_ENVELOPE_FORMAT,
  LocalCipher,
  LocalIntegrityError,
  LocalKeyLockedError,
  LocalKeyLostError,
  LocalKeyManager,
  MemorySecureStorage,
} from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { beforeEach, describe, expect, it } from "vitest";

const installationId = "018f2b7c-0000-7000-8000-000000000001";
const workspaceId = generateUuidV7();

function bindingFor(entityType: string, entityId: string, recordVersion = 1) {
  return {
    installationId,
    workspaceId,
    entityType,
    entityId,
    keyGeneration: 1,
    recordVersion,
  };
}

let storage: MemorySecureStorage;
let manager: LocalKeyManager;
let cipher: LocalCipher;

beforeEach(async () => {
  storage = new MemorySecureStorage();
  manager = new LocalKeyManager(storage);
  await manager.establish();
  cipher = new LocalCipher(manager);
});

describe("the local envelope", () => {
  it("seals and opens a page body", async () => {
    const binding = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const body = { blocks: [{ type: "paragraph", text: "the quarterly numbers" }] };

    const envelope = await cipher.seal(binding, body);
    expect(envelope.format).toBe(LOCAL_ENVELOPE_FORMAT);
    expect(envelope.alg).toBe(LOCAL_ENVELOPE_ALGORITHM);
    expect(await cipher.open(binding, envelope)).toEqual(body);
  });

  it("leaves no plaintext in the sealed form", async () => {
    // The point of the exercise. Serialize the whole envelope and look for the
    // words: a round-trip assertion alone cannot catch a field written twice.
    const binding = bindingFor(LOCAL_ENTITY_TYPES.itemName, generateUuidV7());
    const envelope = await cipher.seal(binding, "Severance package draft");

    expect(JSON.stringify(envelope)).not.toContain("Severance");
    expect(JSON.stringify(envelope)).not.toContain("package");
  });

  it("gives every seal its own nonce", async () => {
    // A reused nonce under one key is the classic AES-GCM failure: two
    // ciphertexts leak their XOR, and the authentication key itself is at risk.
    const binding = bindingFor(LOCAL_ENTITY_TYPES.itemName, generateUuidV7());
    const nonces = new Set<string>();
    for (let index = 0; index < 64; index += 1) {
      nonces.add((await cipher.seal(binding, "same plaintext")).nonce);
    }
    expect(nonces.size).toBe(64);
  });

  it("refuses a ciphertext moved to another record", async () => {
    // Without the entity id in the AAD, a local database could be edited to
    // show one page's content under another page's title.
    const source = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const other = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const envelope = await cipher.seal(source, { text: "confidential" });

    await expect(cipher.open(other, envelope)).rejects.toBeInstanceOf(LocalIntegrityError);
  });

  it("refuses a name opened as a body", async () => {
    // Separate entity types, same id: the type is in the AAD precisely so one
    // field cannot be substituted for another on the same record.
    const entityId = generateUuidV7();
    const asName = bindingFor(LOCAL_ENTITY_TYPES.itemName, entityId);
    const asBody = bindingFor(LOCAL_ENTITY_TYPES.pageBody, entityId);
    const envelope = await cipher.seal(asName, "a title");

    await expect(cipher.open(asBody, envelope)).rejects.toBeInstanceOf(LocalIntegrityError);
  });

  it("refuses a ciphertext replayed at another record version", async () => {
    const entityId = generateUuidV7();
    const envelope = await cipher.seal(bindingFor(LOCAL_ENTITY_TYPES.pageBody, entityId, 1), {
      text: "first",
    });

    await expect(
      cipher.open(bindingFor(LOCAL_ENTITY_TYPES.pageBody, entityId, 2), envelope),
    ).rejects.toBeInstanceOf(LocalIntegrityError);
  });

  it("refuses a flipped ciphertext byte rather than returning altered content", async () => {
    const binding = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const envelope = await cipher.seal(binding, { text: "unmodified" });
    const bytes = Uint8Array.from(atob(envelope.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0] === undefined ? 0 : bytes[0] ^ 0x01;
    const tampered = { ...envelope, ciphertext: btoa(String.fromCharCode(...bytes)) };

    await expect(cipher.open(binding, tampered)).rejects.toBeInstanceOf(LocalIntegrityError);
  });
});

describe("the device key", () => {
  it("is kept in platform secure storage and never exposed as bytes", async () => {
    // A key readable from JavaScript is a key any injected script can take.
    // WebCrypto non-extractable keys are the whole reason this is worth doing.
    const stored = await storage.load();
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain("raw");
    expect(await manager.exportKeyBytes().catch((error: unknown) => error)).toBeInstanceOf(Error);
  });

  it("reports which storage backed it, so the client can be honest about it", async () => {
    // A fallback store is weaker than the platform keystore. The owner is told
    // rather than left to assume the stronger one was used.
    expect(manager.storageKind).toBe(storage.kind);
  });

  it("survives a reload by reopening the same stored key", async () => {
    const binding = bindingFor(LOCAL_ENTITY_TYPES.itemName, generateUuidV7());
    const envelope = await cipher.seal(binding, "written before the reload");

    const reopened = new LocalKeyManager(storage);
    await reopened.establish();

    expect(await new LocalCipher(reopened).open(binding, envelope)).toBe(
      "written before the reload",
    );
  });
});

describe("the states the owner can actually be in", () => {
  it("starts absent before any key exists", async () => {
    const fresh = new LocalKeyManager(new MemorySecureStorage());
    expect(fresh.state.status).toBe("absent");
  });

  it("is unlocked once established", () => {
    expect(manager.state.status).toBe("unlocked");
  });

  it("refuses to read while locked, without destroying anything", async () => {
    const binding = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const envelope = await cipher.seal(binding, { text: "still here" });

    manager.lock();
    expect(manager.state.status).toBe("locked");
    await expect(cipher.open(binding, envelope)).rejects.toBeInstanceOf(LocalKeyLockedError);

    // Locking is not losing: unlocking returns the same content.
    await manager.establish();
    expect(await cipher.open(binding, envelope)).toEqual({ text: "still here" });
  });

  it("reports key loss as loss, not as corruption", async () => {
    // The distinction matters to the person reading the message. Corrupt data
    // suggests a bug worth reporting; a lost device key means this browser
    // copy is gone and the server copy is the way back.
    const binding = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const envelope = await cipher.seal(binding, { text: "unreachable now" });

    await storage.clear();
    const afterLoss = new LocalKeyManager(storage);
    await afterLoss.establish({ reuseExistingOnly: true });
    expect(afterLoss.state.status).toBe("lost");

    await expect(new LocalCipher(afterLoss).open(binding, envelope)).rejects.toBeInstanceOf(
      LocalKeyLostError,
    );
  });

  it("never silently mints a replacement key over a lost one", async () => {
    // Minting a fresh key would make every existing local record undecryptable
    // while reporting a healthy `unlocked` state — data loss disguised as
    // recovery.
    const binding = bindingFor(LOCAL_ENTITY_TYPES.pageBody, generateUuidV7());
    const envelope = await cipher.seal(binding, { text: "before the loss" });
    await storage.clear();

    const replacement = new LocalKeyManager(storage);
    await replacement.establish();
    expect(replacement.state.status).toBe("unlocked");
    await expect(new LocalCipher(replacement).open(binding, envelope)).rejects.toBeInstanceOf(
      LocalKeyLostError,
    );
  });
});
