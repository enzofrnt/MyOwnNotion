/**
 * Development filesystem adapter (T019).
 *
 * Content-addressed layout: blobs live at `<root>/<aa>/<digest>` where `aa`
 * is the first digest byte. Writes go to a temporary file first and are
 * renamed into place after verification, so a crash never leaves a partial
 * blob at a final key.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlobStore, StoredBlob } from "./blob-store.ts";

function digestHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class FilesystemBlobStore implements BlobStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #pathFor(storageKey: string): string {
    if (!/^[a-f0-9]{64}$/.test(storageKey)) {
      throw new RangeError("invalid storage key");
    }
    return path.join(this.#root, storageKey.slice(0, 2), storageKey);
  }

  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const hex = digestHex(bytes);
    const finalPath = this.#pathFor(hex);
    await mkdir(path.dirname(finalPath), { recursive: true });

    const temporaryPath = path.join(
      path.dirname(finalPath),
      `.tmp-${randomBytes(8).toString("hex")}`,
    );
    await writeFile(temporaryPath, bytes, { flag: "wx" });

    // Verify what was actually persisted before exposing the blob.
    const persisted = await readFile(temporaryPath);
    const persistedDigest = digestHex(persisted);
    if (persistedDigest !== hex || persisted.byteLength !== bytes.byteLength) {
      await rm(temporaryPath, { force: true });
      throw new Error("blob verification failed after write");
    }
    await rename(temporaryPath, finalPath);

    return {
      storageKey: hex,
      sha256: Uint8Array.from(Buffer.from(hex, "hex")),
      byteLength: bytes.byteLength,
      verifiedAt: new Date(),
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    try {
      const bytes = await readFile(this.#pathFor(storageKey));
      return new Uint8Array(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async equals(storageKey: string, candidate: Uint8Array): Promise<boolean> {
    const stored = await this.get(storageKey);
    if (stored === null || stored.byteLength !== candidate.byteLength) {
      return false;
    }
    for (let index = 0; index < stored.byteLength; index += 1) {
      if (stored[index] !== candidate[index]) {
        return false;
      }
    }
    return true;
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.#pathFor(storageKey), { force: true });
  }
}
