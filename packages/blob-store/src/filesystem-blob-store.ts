import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, open as openFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  type BlobHead,
  type BlobListOptions,
  type BlobRange,
  type BlobSource,
  type BlobStore,
  type BlobWriteOptions,
  blobChunks,
  collectBlob,
  equalBlobStreams,
  type OpenedBlob,
  type StoredBlob,
} from "./blob-store.ts";

const STORAGE_KEY_PATTERN = /^[a-f0-9]{64}(?:-[a-f0-9-]{36})?$/;

function validateRange(range: BlobRange): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.endInclusive) ||
    range.start < 0 ||
    range.endInclusive < range.start
  ) {
    throw new RangeError("invalid blob range");
  }
}

export class FilesystemBlobStore implements BlobStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #pathFor(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new RangeError("invalid storage key");
    }
    return path.join(this.#root, storageKey.slice(0, 2), storageKey);
  }

  async put(source: BlobSource, options: BlobWriteOptions = {}): Promise<StoredBlob> {
    const temporaryDirectory = path.join(this.#root, ".tmp");
    await mkdir(temporaryDirectory, { recursive: true });
    const temporaryPath = path.join(temporaryDirectory, randomUUID());
    const handle = await openFile(temporaryPath, "wx");
    const hash = createHash("sha256");
    let byteLength = 0;
    try {
      for await (const chunk of blobChunks(source)) {
        byteLength += chunk.byteLength;
        if (options.maxByteLength !== undefined && byteLength > options.maxByteLength) {
          throw new RangeError("blob exceeds maximum byte length");
        }
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const { bytesWritten } = await handle.write(
            chunk,
            offset,
            chunk.byteLength - offset,
            null,
          );
          if (bytesWritten === 0) {
            throw new Error("blob write made no progress");
          }
          offset += bytesWritten;
        }
      }
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
    await handle.close();

    const digest = hash.digest();
    const hex = digest.toString("hex");
    const persisted = await this.#hashFile(temporaryPath);
    if (persisted.hex !== hex || persisted.byteLength !== byteLength) {
      await rm(temporaryPath, { force: true });
      throw new Error("blob verification failed after write");
    }

    let storageKey = hex;
    let finalPath = this.#pathFor(storageKey);
    await mkdir(path.dirname(finalPath), { recursive: true });
    let created = true;
    try {
      await link(temporaryPath, finalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(temporaryPath, { force: true });
        throw error;
      }
      if (await this.#filesEqual(temporaryPath, finalPath)) {
        created = false;
      } else {
        storageKey = `${hex}-${randomUUID()}`;
        finalPath = this.#pathFor(storageKey);
        await link(temporaryPath, finalPath);
      }
    } finally {
      await rm(temporaryPath, { force: true });
    }

    return {
      storageKey,
      sha256: new Uint8Array(digest),
      byteLength,
      verifiedAt: new Date(),
      created,
    };
  }

  async head(storageKey: string): Promise<BlobHead | null> {
    try {
      const metadata = await stat(this.#pathFor(storageKey));
      return { storageKey, byteLength: metadata.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async open(storageKey: string, range?: BlobRange): Promise<OpenedBlob | null> {
    if (range !== undefined) {
      validateRange(range);
    }
    const metadata = await this.head(storageKey);
    if (metadata === null) {
      return null;
    }
    if (range !== undefined && range.start >= metadata.byteLength) {
      throw new RangeError("unsatisfiable blob range");
    }
    const effectiveRange =
      range === undefined
        ? null
        : {
            start: range.start,
            endInclusive: Math.min(range.endInclusive, metadata.byteLength - 1),
          };
    const contentLength =
      effectiveRange === null
        ? metadata.byteLength
        : effectiveRange.endInclusive - effectiveRange.start + 1;
    const stream = createReadStream(this.#pathFor(storageKey), {
      ...(effectiveRange === null
        ? {}
        : { start: effectiveRange.start, end: effectiveRange.endInclusive }),
    });
    return {
      ...metadata,
      contentLength,
      range: effectiveRange,
      body: stream,
    };
  }

  async list(options: BlobListOptions = {}): Promise<string[]> {
    const keys: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(this.#root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    for (const directory of entries.sort()) {
      if (!/^[a-f0-9]{2}$/.test(directory)) {
        continue;
      }
      const names = await readdir(path.join(this.#root, directory));
      for (const name of names) {
        if (STORAGE_KEY_PATTERN.test(name)) {
          keys.push(name);
        }
      }
    }
    if (options.includeTemporary === true && entries.includes(".tmp")) {
      const temporaryNames = await readdir(path.join(this.#root, ".tmp"));
      for (const name of temporaryNames.sort()) {
        if (/^[a-f0-9-]{36}$/i.test(name)) {
          keys.push(`.tmp/${name}`);
        }
      }
    }
    return keys.sort();
  }

  async compare(leftStorageKey: string, rightStorageKey: string): Promise<boolean> {
    const [left, right] = await Promise.all([
      this.open(leftStorageKey),
      this.open(rightStorageKey),
    ]);
    if (left === null || right === null || left.byteLength !== right.byteLength) {
      return false;
    }
    return equalBlobStreams(left.body, right.body);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    const opened = await this.open(storageKey);
    return opened === null ? null : collectBlob(opened.body);
  }

  async equals(storageKey: string, candidate: Uint8Array): Promise<boolean> {
    const opened = await this.open(storageKey);
    if (opened === null || opened.byteLength !== candidate.byteLength) {
      return false;
    }
    return equalBlobStreams(
      opened.body,
      (async function* () {
        yield candidate;
      })(),
    );
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.#pathFor(storageKey), { force: true });
  }

  async #hashFile(filePath: string): Promise<{ hex: string; byteLength: number }> {
    const hash = createHash("sha256");
    let byteLength = 0;
    const handle = await openFile(filePath, "r");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, byteLength);
        if (bytesRead === 0) break;
        hash.update(buffer.subarray(0, bytesRead));
        byteLength += bytesRead;
      }
    } finally {
      await handle.close();
    }
    return { hex: hash.digest("hex"), byteLength };
  }

  async #filesEqual(leftPath: string, rightPath: string): Promise<boolean> {
    const [left, right] = await Promise.all([stat(leftPath), stat(rightPath)]);
    if (left.size !== right.size) {
      return false;
    }
    return equalBlobStreams(createReadStream(leftPath), createReadStream(rightPath));
  }
}
