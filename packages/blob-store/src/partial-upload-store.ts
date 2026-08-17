/**
 * Bytes of a transfer that is not finished (feature 005, FR-006).
 *
 * Deliberately *not* a `BlobStore`. A blob is addressed by the digest of its
 * content, and a partial upload has no digest yet — that is the whole point of
 * it being partial. Forcing it into the blob store would mean either inventing a
 * key that is not a digest, breaking the one invariant that store has, or
 * hashing on every chunk, which for a 2 GB file means hashing 2 GB hundreds of
 * times.
 *
 * So partial uploads live in their own directory, keyed by upload identity, and
 * only become a blob when they are complete and can be hashed once.
 */

import { createReadStream } from "node:fs";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export class PartialUploadStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  #pathFor(uploadId: string): string {
    // Upload identities are UUIDs. Checked rather than trusted, because this
    // value reaches the filesystem and a caller that passed `../` would be
    // writing wherever it liked.
    if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
      throw new RangeError("invalid upload identity");
    }
    return path.join(this.#root, "uploads", uploadId);
  }

  /**
   * Appends a chunk at the end of what is already there.
   *
   * Append rather than write-at-offset, and the caller has already been told by
   * the database whether its offset matches. The two together are what make a
   * resumed transfer safe: the database refuses a chunk from the wrong place, so
   * anything reaching here belongs exactly at the end.
   */
  async append(uploadId: string, bytes: Uint8Array): Promise<void> {
    const target = this.#pathFor(uploadId);
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, bytes);
  }

  /** How many bytes are on disk, for reconciling with the recorded offset. */
  async size(uploadId: string): Promise<number> {
    try {
      return (await stat(this.#pathFor(uploadId))).size;
    } catch {
      return 0;
    }
  }

  /** The accumulated bytes, for hashing and ingesting once complete. */
  async read(uploadId: string): Promise<Uint8Array | null> {
    const target = this.#pathFor(uploadId);
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of createReadStream(target)) {
        chunks.push(chunk as Buffer);
      }
      return new Uint8Array(Buffer.concat(chunks));
    } catch {
      return null;
    }
  }

  /** Removes the partial file, whether it completed or expired. */
  async discard(uploadId: string): Promise<void> {
    await rm(this.#pathFor(uploadId), { force: true });
  }
}
