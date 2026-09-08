import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeKeyStorage, type SafeStorageLike } from "../src/native-key-storage.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function directory() {
  const dir = mkdtempSync(path.join(tmpdir(), "desktop-key-"));
  dirs.push(dir);
  return dir;
}
function safeStorage(): SafeStorageLike {
  const key = randomBytes(32);
  return {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    async encryptStringAsync(plain) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    async decryptStringAsync(encrypted) {
      const cipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(0, 12));
      cipher.setAuthTag(encrypted.subarray(12, 28));
      return {
        result: Buffer.concat([cipher.update(encrypted.subarray(28)), cipher.final()]).toString(
          "utf8",
        ),
        shouldReEncrypt: false,
      };
    },
  };
}
describe("native key storage", () => {
  it("recovers the same protected key after restart without storing key material", async () => {
    const options = {
      userData: directory(),
      platform: "linux" as const,
      safeStorage: safeStorage(),
    };
    const bytes = randomBytes(32);
    const original = Buffer.from(bytes);
    const result = await createNativeKeyStorage(options).wrap(bytes, "key-1");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("wrap failed");
    const disk = readFileSync(path.join(options.userData, "device-key.envelope"), "utf8");
    expect(disk).not.toContain(original.toString("base64"));
    const reopened = await createNativeKeyStorage(options).unwrap(result.envelope);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(Buffer.from(reopened.bytes)).toEqual(original);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it.each(["basic_text", "unknown"])("refuses the Linux %s backend", async (backend) => {
    const storage = createNativeKeyStorage({
      userData: directory(),
      platform: "linux",
      safeStorage: { ...safeStorage(), getSelectedStorageBackend: () => backend },
    });
    expect((await storage.state()).state).toBe("unavailable");
    expect((await storage.wrap(randomBytes(32), "key")).ok).toBe(false);
  });
  it("fails closed when the OS is temporarily unavailable", async () => {
    const storage = createNativeKeyStorage({
      userData: directory(),
      platform: "darwin",
      safeStorage: {
        ...safeStorage(),
        isAsyncEncryptionAvailable: async () => {
          throw new Error("locked");
        },
      },
    });
    expect((await storage.state()).state).toBe("unavailable");
    expect((await storage.wrap(randomBytes(32), "key")).ok).toBe(false);
  });
  it("preserves revocation across process restart", async () => {
    const options = {
      userData: directory(),
      platform: "win32" as const,
      safeStorage: safeStorage(),
    };
    await createNativeKeyStorage(options).revoke();
    const storage = createNativeKeyStorage(options);
    expect((await storage.state()).state).toBe("revoked");
    expect((await storage.wrap(randomBytes(32), "key")).ok).toBe(false);
  });
  it("rejects a key envelope belonging to another profile", async () => {
    const os = safeStorage();
    const a = createNativeKeyStorage({
      userData: directory(),
      platform: "darwin",
      safeStorage: os,
    });
    const b = createNativeKeyStorage({
      userData: directory(),
      platform: "darwin",
      safeStorage: os,
    });
    const wrapped = await a.wrap(randomBytes(32), "key-a");
    await b.wrap(randomBytes(32), "key-b");
    if (!wrapped.ok) throw new Error("wrap failed");
    expect((await b.unwrap(wrapped.envelope)).ok).toBe(false);
  });
});

it("migrates the original development envelope without replacing the legacy key", async () => {
  const legacyUserData = directory();
  const os = safeStorage();
  const original = randomBytes(32);
  const legacy = await createNativeKeyStorage({
    userData: legacyUserData,
    platform: "darwin",
    safeStorage: os,
  }).wrap(Buffer.from(original), "legacy-key");
  if (!legacy.ok) throw new Error("wrap failed");
  const oldFile = readFileSync(path.join(legacyUserData, "device-key.envelope"));
  const userData = path.join(legacyUserData, "vaults", "profile");
  const migrated = createNativeKeyStorage({
    userData,
    legacyUserData,
    platform: "darwin",
    safeStorage: os,
  });
  const result = await migrated.unwrap(legacy.envelope);
  expect(result.ok).toBe(true);
  if (result.ok) expect(Buffer.from(result.bytes)).toEqual(original);
  expect(readFileSync(path.join(legacyUserData, "device-key.envelope"))).toEqual(oldFile);
  expect(
    (
      await createNativeKeyStorage({ userData, platform: "darwin", safeStorage: os }).unwrap(
        legacy.envelope,
      )
    ).ok,
  ).toBe(true);
  expect((await migrated.wrap(randomBytes(32), "replacement")).ok).toBe(false);
  expect((await migrated.unwrap(legacy.envelope)).ok).toBe(true);
});
