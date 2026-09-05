/** Streaming AES-GCM components; unverified plaintext must never reach restore. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { type FileHandle, open, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { open as openEnvelope, seal } from "@myownnotion/domain/security";

export const FULL_CIPHER_OVERHEAD = 28;
export const MANIFEST_AAD = Buffer.from("myownnotion.full-backup.manifest.v1");

export function componentAad(backupId: string, index: number, relativePath: string): Buffer {
  return Buffer.from(
    `myownnotion.full-backup.component.v1:${JSON.stringify([backupId, index, relativePath])}`,
  );
}

export async function readExactly(
  handle: FileHandle,
  byteLength: number,
  position: number,
): Promise<Buffer> {
  const result = Buffer.alloc(byteLength);
  let offset = 0;
  while (offset < byteLength) {
    const read = await handle.read(result, offset, byteLength - offset, position + offset);
    if (read.bytesRead === 0) throw new Error("The complete backup is truncated.");
    offset += read.bytesRead;
  }
  return result;
}

export async function writeExactly(
  handle: FileHandle,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
    if (written.bytesWritten === 0) throw new Error("The complete backup could not be written.");
    offset += written.bytesWritten;
  }
}

export function sealFullManifest(key: Uint8Array, plaintext: Uint8Array): Buffer {
  const envelope = seal(key, plaintext, MANIFEST_AAD);
  return Buffer.concat([
    Buffer.from(envelope.nonce),
    Buffer.from(envelope.tag),
    Buffer.from(envelope.ciphertext),
  ]);
}

export function openFullManifest(key: Uint8Array, ciphertext: Buffer): Buffer {
  if (ciphertext.byteLength < FULL_CIPHER_OVERHEAD)
    throw new Error("The encrypted manifest is truncated.");
  return Buffer.from(
    openEnvelope(
      key,
      {
        nonce: ciphertext.subarray(0, 12),
        tag: ciphertext.subarray(12, 28),
        ciphertext: ciphertext.subarray(28),
      },
      MANIFEST_AAD,
    ),
  );
}

/** Only ciphertext is ever written to disk, including during a failed dump. */
export async function sealFullStream(
  input: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  aad: Uint8Array,
  destination: string,
): Promise<{ byteLength: number; sha256: string }> {
  const ownedKey = Buffer.from(key);
  let handle: FileHandle | undefined;
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", ownedKey, nonce);
    cipher.setAAD(aad);
    const hash = createHash("sha256");
    let byteLength = 0;
    handle = await open(destination, "wx+", 0o600);
    await writeExactly(handle, Buffer.concat([nonce, Buffer.alloc(16)]), 0);
    async function* measured(): AsyncGenerator<Uint8Array> {
      for await (const chunk of input) {
        byteLength += chunk.byteLength;
        if (!Number.isSafeInteger(byteLength))
          throw new Error("The backup component exceeds safe addressing.");
        hash.update(chunk);
        yield chunk;
      }
    }
    await pipeline(
      Readable.from(measured()),
      cipher,
      createWriteStream(destination, {
        fd: handle.fd,
        start: FULL_CIPHER_OVERHEAD,
        autoClose: false,
      }),
    );
    await writeExactly(handle, cipher.getAuthTag(), 12);
    await handle.sync();
    return { byteLength, sha256: hash.digest("hex") };
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
      await rm(destination, { force: true });
    }
    throw error;
  } finally {
    ownedKey.fill(0);
    await handle?.close().catch(() => undefined);
  }
}

/** The caller must authenticate a whole archive before consuming this for writes. */
export async function* openFullStream(
  handle: FileHandle,
  offset: number,
  byteLength: number,
  key: Uint8Array,
  aad: Uint8Array,
): AsyncGenerator<Buffer> {
  const header = await readExactly(handle, FULL_CIPHER_OVERHEAD, offset);
  const ownedKey = Buffer.from(key);
  const decipher = createDecipheriv("aes-256-gcm", ownedKey, header.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(header.subarray(12));
  try {
    if (byteLength > 0) {
      const source = handle.createReadStream({
        start: offset + FULL_CIPHER_OVERHEAD,
        end: offset + FULL_CIPHER_OVERHEAD + byteLength - 1,
        autoClose: false,
      });
      let received = 0;
      for await (const chunk of source) {
        const bytes = chunk as Buffer;
        received += bytes.byteLength;
        const clear = decipher.update(bytes);
        if (clear.byteLength > 0) yield clear;
      }
      if (received !== byteLength) throw new Error("The encrypted component is truncated.");
    }
    const final = decipher.final();
    if (final.byteLength > 0) yield final;
  } finally {
    ownedKey.fill(0);
  }
}
