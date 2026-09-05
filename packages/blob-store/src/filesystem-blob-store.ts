/**
 * Durable immutable filesystem adapter (T019, feature 025 T006).
 *
 * Content-addressed layout: blobs live at `<root>/<aa>/<digest>` where `aa`
 * is the first digest byte. Writes go to a temporary file first and are
 * linked into place after verification and fsync. Publication never overwrites
 * an existing key, and succeeds only after the containing directory is synced.
 */
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import type { BlobStore, StoredBlob } from "./blob-store.ts";

function digestHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireDirectory(directory: string): Promise<void> {
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error("Blob storage requires a real directory.");
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
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
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    await requireDirectory(this.#root);
    await syncDirectory(path.dirname(this.#root));
    const directory = path.dirname(finalPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await requireDirectory(directory);
    await syncDirectory(this.#root);

    const temporaryPath = path.join(
      path.dirname(finalPath),
      `.tmp-${randomBytes(8).toString("hex")}`,
    );
    const handle = await open(temporaryPath, "wx+", 0o600);
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
        if (written.bytesWritten === 0) throw new Error("Blob write made no progress.");
        offset += written.bytesWritten;
      }
      const persisted = await handle.readFile();
      if (digestHex(persisted) !== hex || persisted.byteLength !== bytes.byteLength)
        throw new Error("Blob verification failed after write.");
      await handle.sync();
      try {
        await link(temporaryPath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (!(await this.equals(hex, bytes)))
          throw new Error("An existing immutable blob does not match its storage key.");
      }
      await syncDirectory(directory);
    } finally {
      try {
        await handle.close();
      } finally {
        await rm(temporaryPath, { force: true });
        await syncDirectory(directory);
      }
    }

    return {
      storageKey: hex,
      sha256: Uint8Array.from(Buffer.from(hex, "hex")),
      byteLength: bytes.byteLength,
      verifiedAt: new Date(),
    };
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    try {
      const filename = this.#pathFor(storageKey);
      await requireDirectory(this.#root);
      await requireDirectory(path.dirname(filename));
      const handle = await open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        if (!(await handle.stat()).isFile()) throw new Error("Blob is not a regular file.");
        const bytes = await handle.readFile();
        if (digestHex(bytes) !== storageKey) throw new Error("Stored blob digest mismatch.");
        return new Uint8Array(bytes);
      } finally {
        await handle.close();
      }
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
    const filename = this.#pathFor(storageKey);
    try {
      await requireDirectory(this.#root);
      await requireDirectory(path.dirname(filename));
      await rm(filename, { force: true });
      await syncDirectory(path.dirname(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
