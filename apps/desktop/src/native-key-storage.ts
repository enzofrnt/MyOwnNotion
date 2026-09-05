import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DesktopPlatform,
  KeyStateResult,
  UnwrappedKeyResult,
  WrappedKeyEnvelope,
  WrappedKeyResult,
} from "./ipc-contract.ts";
import { isWrappedKeyEnvelope } from "./ipc-validation.ts";
import { keyStateFromPlatform } from "./key-state.ts";
import { ensureVaultFormat } from "./vault-migrations.ts";

export interface SafeStorageLike {
  isEncryptionAvailable?(): boolean;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend?(): string;
}
export interface NativeKeyStorage {
  state(): Promise<KeyStateResult>;
  wrap(bytes: Uint8Array, keyId: string): Promise<WrappedKeyResult>;
  unwrap(envelope: WrappedKeyEnvelope): Promise<UnwrappedKeyResult>;
  revoke(): Promise<void>;
  clear(): Promise<void>;
}

/** One store per profile; unavailable OS encryption never becomes plaintext. */
export function createNativeKeyStorage(options: {
  readonly userData: string;
  readonly legacyUserData?: string;
  readonly platform: DesktopPlatform;
  readonly safeStorage: SafeStorageLike;
}): NativeKeyStorage {
  const envelopePath = path.join(options.userData, "device-key.envelope");
  const revokePath = path.join(options.userData, "device-key.revoked");
  const available = async (): Promise<boolean> => {
    try {
      await ensureVaultFormat(options.userData);
      if (options.platform === "linux") {
        if (options.safeStorage.isEncryptionAvailable?.() === false) return false;
        const backend = options.safeStorage.getSelectedStorageBackend?.();
        if (backend === undefined || backend === "basic_text" || backend === "unknown")
          return false;
      }
      return await options.safeStorage.isAsyncEncryptionAvailable();
    } catch {
      return false;
    }
  };
  const readEnvelope = async (file = envelopePath): Promise<WrappedKeyEnvelope | null> => {
    try {
      const value: unknown = JSON.parse(await readFile(file, "utf8"));
      return isWrappedKeyEnvelope(value) ? (value as WrappedKeyEnvelope) : null;
    } catch {
      return null;
    }
  };
  const exists = async (file: string): Promise<boolean> => {
    try {
      await readFile(file);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  };
  const revoked = async (): Promise<boolean> => {
    try {
      await readFile(revokePath);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  };
  const persist = async (envelope: WrappedKeyEnvelope): Promise<void> => {
    await mkdir(options.userData, { recursive: true, mode: 0o700 });
    const temporary = `${envelopePath}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await rename(temporary, envelopePath);
  };
  let wrapping = false;
  return {
    async state() {
      return keyStateFromPlatform({
        encryptionAvailable: await available(),
        hasEnvelope: (await readEnvelope()) !== null,
        locked: false,
        revoked: await revoked(),
        platform: options.platform,
      });
    },
    async wrap(bytes, keyId) {
      if (wrapping) {
        bytes.fill(0);
        return {
          ok: false,
          state: "unavailable",
          message: "A key operation is already in progress.",
        };
      }
      wrapping = true;
      try {
        const state = await this.state();
        if (!state.encryptionAvailable || state.state === "revoked")
          return { ok: false, state: state.state, message: "The OS key store is unavailable." };
        if (bytes.length !== 32)
          return { ok: false, state: "unavailable", message: "Invalid device key." };

        if (await exists(envelopePath))
          throw new Error("An existing key must never be replaced implicitly");
        const ciphertext = await options.safeStorage.encryptStringAsync(
          Buffer.from(bytes).toString("base64"),
        );
        const envelope: WrappedKeyEnvelope = {
          keyId,
          algorithm: "os-protected-envelope-v1",
          ciphertext: ciphertext.toString("base64"),
          createdAt: new Date().toISOString(),
          revokedAt: null,
        };
        await persist(envelope);
        return { ok: true, envelope };
      } catch {
        return {
          ok: false,
          state: "unavailable",
          message: "The OS key store could not protect the key.",
        };
      } finally {
        wrapping = false;
        bytes.fill(0);
      }
    },
    async unwrap(envelope) {
      const state = await this.state();
      if (
        !state.encryptionAvailable ||
        state.state === "revoked" ||
        !isWrappedKeyEnvelope(envelope)
      )
        return { ok: false, state: state.state, message: "The OS key store is unavailable." };
      try {
        let stored = await readEnvelope();
        let migrating = false;
        // Older development builds shared a host envelope. Adopt it only when
        // this profile already holds that exact key identity in its IndexedDB.
        // Keep the original file for other profiles and rollback.
        if (stored === null && !(await exists(envelopePath)) && options.legacyUserData) {
          const legacy = await readEnvelope(
            path.join(options.legacyUserData, "device-key.envelope"),
          );
          if (
            legacy?.keyId === envelope.keyId &&
            !(await exists(path.join(options.legacyUserData, "device-key.revoked")))
          ) {
            stored = legacy;
            migrating = true;
          }
        }
        if (stored === null || stored.keyId !== envelope.keyId) throw new Error("foreign key");
        const opened = await options.safeStorage.decryptStringAsync(
          Buffer.from(stored.ciphertext, "base64"),
        );
        const bytes = Uint8Array.from(Buffer.from(opened.result, "base64"));
        if (bytes.length !== 32) throw new Error("invalid key length");
        if (opened.shouldReEncrypt || migrating) {
          const ciphertext = await options.safeStorage.encryptStringAsync(opened.result);
          await persist({ ...stored, ciphertext: ciphertext.toString("base64") });
        }
        return { ok: true, bytes };
      } catch {
        return { ok: false, state: "unavailable", message: "The wrapped key could not be opened." };
      }
    },
    async revoke() {
      await mkdir(options.userData, { recursive: true, mode: 0o700 });
      await writeFile(revokePath, "revoked\n", { mode: 0o600 });
    },
    async clear() {
      await this.revoke();
    },
  };
}
