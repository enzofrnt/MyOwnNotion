/** The stable sealed form used by backup commands and the scheduler (FR-007). */

import { createCipheriv, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open as openFile, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { open, seal } from "@myownnotion/domain/security";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from("myownnotion.backup.v1", "utf8");
const CIPHER = "aes-256-gcm";

/** Seals one complete archive before a destination can observe any of it. */
export function sealBackupArchive(key: Uint8Array, plaintext: Buffer): Buffer {
  const sealed = seal(key, plaintext, AAD);
  return Buffer.concat([
    Buffer.from(sealed.nonce),
    Buffer.from(sealed.tag),
    Buffer.from(sealed.ciphertext),
  ]);
}

/**
 * Seals a staged archive without loading it all into memory.
 *
 * The stable framing stores the authentication tag before the ciphertext. GCM
 * only produces that tag at the end, so the writer reserves its sixteen bytes,
 * streams the ciphertext, then seeks back to fill the tag before syncing.
 */
export async function sealBackupArchiveFile(
  key: Uint8Array,
  plaintextPath: string,
  sealedPath: string,
): Promise<void> {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(CIPHER, Buffer.from(key), nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const handle = await openFile(sealedPath, "wx+", 0o600);
  try {
    await handle.write(nonce, 0, nonce.byteLength, 0);
    await handle.write(Buffer.alloc(TAG_BYTES), 0, TAG_BYTES, NONCE_BYTES);
    await pipeline(
      createReadStream(plaintextPath),
      cipher,
      createWriteStream(sealedPath, {
        fd: handle.fd,
        start: NONCE_BYTES + TAG_BYTES,
        autoClose: false,
      }),
    );
    const tag = cipher.getAuthTag();
    await handle.write(tag, 0, tag.byteLength, NONCE_BYTES);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(sealedPath, { force: true });
    throw error;
  }
  await handle.close();
}

/** Opens and authenticates the exact framing written by `sealBackupArchive`. */
export function openBackupArchive(key: Uint8Array, ciphertext: Buffer): Buffer {
  if (ciphertext.byteLength < NONCE_BYTES + TAG_BYTES) {
    throw new Error("the sealed backup is truncated");
  }
  const nonce = ciphertext.subarray(0, NONCE_BYTES);
  const tag = ciphertext.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const body = ciphertext.subarray(NONCE_BYTES + TAG_BYTES);
  return Buffer.from(open(key, { nonce, tag, ciphertext: body }, AAD));
}
