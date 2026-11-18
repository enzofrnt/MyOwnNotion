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
import { type FileHandle, link, lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import type { BlobPutOptions, BlobStore, StoredBlob } from "./blob-store.ts";

function digestHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireDirectory(directory: string): Promise<void> {
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink())
    throw new Error("Blob storage requires a real directory.");
}

type DescriptorKind = "directory" | "staging file" | "stored file";

/** Add the JS ownership boundary missing from native filesystem errors. */
async function descriptorOperation<T>(
  operation: "open" | "fsync" | "close",
  kind: DescriptorKind,
  filename: string,
  fd: number | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    const error = new Error(
      `Blob storage ${kind} ${operation} failed (path=${JSON.stringify(filename)}, fd=${fd ?? "unopened"}): ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    Object.assign(error, {
      code: (cause as NodeJS.ErrnoException | null)?.code,
      syscall: (cause as NodeJS.ErrnoException | null)?.syscall,
      path: filename,
      fd,
    });
    throw error;
  }
}

async function closeDescriptor(handle: FileHandle, kind: DescriptorKind, filename: string) {
  await descriptorOperation("close", kind, filename, handle.fd, () => handle.close());
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await descriptorOperation("open", "directory", directory, undefined, () =>
    open(directory, constants.O_RDONLY | constants.O_NOFOLLOW),
  );
  try {
    await descriptorOperation("fsync", "directory", directory, handle.fd, () => handle.sync());
  } finally {
    await closeDescriptor(handle, "directory", directory);
  }
}

/** Verify persisted bytes with bounded scratch space, including short reads and extra tails. */
async function verifyPersistedBlob(
  handle: FileHandle,
  expectedDigest: string,
  expectedLength: number,
): Promise<void> {
  const scratch = Buffer.allocUnsafe(64 * 1024);
  const digest = createHash("sha256");
  let offset = 0;
  while (true) {
    const { bytesRead } = await handle.read(scratch, 0, scratch.length, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
    if (offset > expectedLength) throw new Error("Blob verification failed after write.");
    digest.update(scratch.subarray(0, bytesRead));
  }
  if (offset !== expectedLength || digest.digest("hex") !== expectedDigest)
    throw new Error("Blob verification failed after write.");
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

  async put(bytes: Uint8Array, options?: BlobPutOptions): Promise<StoredBlob> {
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
    await options?.beforeWrite?.(hex);
    const handle = await descriptorOperation("open", "staging file", temporaryPath, undefined, () =>
      open(temporaryPath, "wx+", 0o600),
    );
    try {
      let offset = 0;
      while (offset < bytes.byteLength) {
        const written = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
        if (written.bytesWritten === 0) throw new Error("Blob write made no progress.");
        offset += written.bytesWritten;
      }
      await verifyPersistedBlob(handle, hex, bytes.byteLength);
      await descriptorOperation("fsync", "staging file", temporaryPath, handle.fd, () =>
        handle.sync(),
      );
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
        await closeDescriptor(handle, "staging file", temporaryPath);
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
      const handle = await descriptorOperation("open", "stored file", filename, undefined, () =>
        open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
      );
      try {
        const status = await handle.stat();
        if (!status.isFile()) throw new Error("Blob is not a regular file.");
        // Bun's positional fs read uses Buffer storage directly; a plain
        // Uint8Array adds transient conversion pressure across large streams.
        const bytes = Buffer.allocUnsafe(status.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
          if (bytesRead === 0) throw new Error("Stored blob length mismatch.");
          offset += bytesRead;
        }
        const tail = new Uint8Array(1);
        if ((await handle.read(tail, 0, 1, offset)).bytesRead !== 0)
          throw new Error("Stored blob length mismatch.");
        if (digestHex(bytes) !== storageKey) throw new Error("Stored blob digest mismatch.");
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      } finally {
        await closeDescriptor(handle, "stored file", filename);
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
