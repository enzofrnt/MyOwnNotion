/** Self-contained encrypted archives; external input is owned before validation. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, link, mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type FullBackupManifest, readFullBackupManifest } from "@myownnotion/domain";
import {
  componentAad,
  FULL_CIPHER_OVERHEAD,
  openFullManifest,
  openFullStream,
  readExactly,
  sealFullManifest,
  writeExactly,
} from "./crypto.ts";

export const FULL_ARCHIVE_MAGIC = Buffer.from("MYOWNNOTION-FULL-1\n");
export const MAX_FULL_MANIFEST_BYTES = 64 * 1024 * 1024;

async function regularFile(path: string): Promise<FileHandle> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new Error("A complete backup must be a regular file.");
  }
  return handle;
}

async function appendFile(
  source: FileHandle,
  target: FileHandle,
  position: number,
): Promise<number> {
  for await (const chunk of source.createReadStream({ autoClose: false })) {
    const bytes = chunk as Buffer;
    await writeExactly(target, bytes, position);
    position += bytes.byteLength;
    if (!Number.isSafeInteger(position)) throw new Error("The archive exceeds safe addressing.");
  }
  return position;
}

async function inventory(
  handle: FileHandle,
  key: Uint8Array,
): Promise<{
  manifest: FullBackupManifest;
  offsets: readonly number[];
}> {
  const prefix = await readExactly(handle, FULL_ARCHIVE_MAGIC.byteLength + 4, 0);
  if (!prefix.subarray(0, FULL_ARCHIVE_MAGIC.byteLength).equals(FULL_ARCHIVE_MAGIC)) {
    throw new Error("Unsupported complete-backup format.");
  }
  const length = prefix.readUInt32BE(FULL_ARCHIVE_MAGIC.byteLength);
  if (length < FULL_CIPHER_OVERHEAD || length > MAX_FULL_MANIFEST_BYTES) {
    throw new Error("The encrypted manifest length is invalid.");
  }
  const sealed = await readExactly(handle, length, prefix.byteLength);
  const clear = openFullManifest(key, sealed);
  let manifest: FullBackupManifest;
  try {
    manifest = readFullBackupManifest(JSON.parse(clear.toString("utf8")));
  } finally {
    clear.fill(0);
  }
  let position = prefix.byteLength + length;
  const offsets = manifest.components.map((component) => {
    const offset = position;
    position += FULL_CIPHER_OVERHEAD + component.byteLength;
    if (!Number.isSafeInteger(position)) throw new Error("The archive exceeds safe addressing.");
    return offset;
  });
  if ((await handle.stat()).size !== position) {
    throw new Error("The complete backup is truncated or contains trailing data.");
  }
  return { manifest, offsets };
}

async function verifyComponents(
  handle: FileHandle,
  key: Uint8Array,
  manifest: FullBackupManifest,
  offsets: readonly number[],
): Promise<void> {
  for (const [index, component] of manifest.components.entries()) {
    const hash = createHash("sha256");
    for await (const bytes of openFullStream(
      handle,
      offsets[index] as number,
      component.byteLength,
      key,
      componentAad(manifest.backupId, index, component.path),
    )) {
      hash.update(bytes);
      bytes.fill(0);
    }
    if (hash.digest("hex") !== component.sha256) {
      throw new Error("A complete-backup component failed integrity verification.");
    }
  }
}

/** Publish only a fully verified artifact, without replacing an existing backup. */
export async function writeFullArchive(input: {
  manifest: FullBackupManifest;
  encryptedComponents: readonly string[];
  key: Uint8Array;
  destination: string;
}): Promise<void> {
  const manifest = readFullBackupManifest(input.manifest);
  if (manifest.components.length !== input.encryptedComponents.length) {
    throw new Error("The staged inventory is incomplete.");
  }
  const clear = Buffer.from(JSON.stringify(manifest));
  let sealed: Buffer;
  try {
    if (clear.byteLength + FULL_CIPHER_OVERHEAD > MAX_FULL_MANIFEST_BYTES) {
      throw new Error("The manifest exceeds the supported size.");
    }
    sealed = sealFullManifest(input.key, clear);
  } finally {
    clear.fill(0);
  }
  const directory = await mkdtemp(join(dirname(input.destination), ".full-publish-"));
  const path = join(directory, "archive");
  try {
    const handle = await open(path, "wx+", 0o600);
    try {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(sealed.byteLength);
      const header = Buffer.concat([FULL_ARCHIVE_MAGIC, length, sealed]);
      await writeExactly(handle, header, 0);
      let position = header.byteLength;
      for (const componentPath of input.encryptedComponents) {
        const source = await regularFile(componentPath);
        try {
          position = await appendFile(source, handle, position);
        } finally {
          await source.close();
        }
      }
      await handle.sync();
      const checked = await inventory(handle, input.key);
      await verifyComponents(handle, input.key, checked.manifest, checked.offsets);
    } finally {
      await handle.close();
    }
    await link(path, input.destination);
    const parent = await open(dirname(input.destination), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Owns a private encrypted snapshot, preventing source replacement after verification. */
export class VerifiedFullArchive {
  private closed = false;

  private constructor(
    readonly manifest: FullBackupManifest,
    private readonly offsets: readonly number[],
    private readonly handle: FileHandle,
    private readonly key: Buffer,
    private readonly directory: string,
  ) {}

  static async open(
    sourcePath: string,
    key: Uint8Array,
    workingDirectory: string,
  ): Promise<VerifiedFullArchive> {
    await mkdir(workingDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(workingDirectory, ".full-verify-"));
    const ownedKey = Buffer.from(key);
    let handle: FileHandle | undefined;
    try {
      handle = await open(join(directory, "archive"), "wx+", 0o600);
      const source = await regularFile(sourcePath);
      try {
        await appendFile(source, handle, 0);
      } finally {
        await source.close();
      }
      const checked = await inventory(handle, ownedKey);
      await verifyComponents(handle, ownedKey, checked.manifest, checked.offsets);
      return new VerifiedFullArchive(
        checked.manifest,
        checked.offsets,
        handle,
        ownedKey,
        directory,
      );
    } catch (error) {
      ownedKey.fill(0);
      await handle?.close();
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  component(index: number): AsyncGenerator<Buffer> {
    if (this.closed) throw new Error("The verified backup is closed.");
    const component = this.manifest.components[index];
    const offset = this.offsets[index];
    if (component === undefined || offset === undefined)
      throw new RangeError("Unknown backup component.");
    return openFullStream(
      this.handle,
      offset,
      component.byteLength,
      this.key,
      componentAad(this.manifest.backupId, index, component.path),
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.key.fill(0);
    try {
      await this.handle.close();
    } finally {
      await rm(this.directory, { recursive: true, force: true });
    }
  }
}
