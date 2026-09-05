/** Validated historical file inventory and bounded reads for the protected transition. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Database, schema, type Transaction } from "@myownnotion/database";
import { generateUuidV7, isUuid } from "@myownnotion/domain";
import { eq } from "drizzle-orm";

export interface LegacyFileSource {
  readonly kind: "content" | "upload" | "orphan";
  readonly objectId: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly referenceCount?: number;
  readonly declaredLength?: number;
  readonly expiresAt?: string;
  readonly metadata?: { readonly originalName: string; readonly mediaType: string };
}

function validPath(path: string): boolean {
  return (
    /^[0-9a-f]{2}\/(?:[0-9a-f]{64}|\.tmp-[0-9a-f]{16})$/.test(path) ||
    (path.startsWith("uploads/") && isUuid(path.slice(8)))
  );
}

async function sourcePath(root: string, path: string): Promise<string> {
  if (!validPath(path)) throw new Error("Invalid historical storage path.");
  for (const directory of [root, join(root, dirname(path))]) {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Historical storage directories must not be symlinks.");
  }
  return join(root, path);
}

/** The final digest is checked even for a prefix; callers commit only after EOF. */
export async function* readLegacyFileSource(
  root: string,
  source: LegacyFileSource,
): AsyncGenerator<Uint8Array> {
  if (
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength < 0 ||
    !/^[0-9a-f]{64}$/.test(source.sha256)
  )
    throw new Error("Invalid historical source inventory.");
  if (source.byteLength === 0 && source.kind === "upload") {
    if (source.sha256 !== createHash("sha256").digest("hex"))
      throw new Error("Invalid empty upload digest.");
    return;
  }
  const handle = await open(
    await sourcePath(root, source.path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.size < source.byteLength ||
      (source.kind !== "upload" && stat.size !== source.byteLength)
    )
      throw new Error("Historical source length changed.");
    const hash = createHash("sha256");
    let length = 0;
    if (source.byteLength > 0) {
      for await (const chunk of handle.createReadStream({
        start: 0,
        end: source.byteLength - 1,
        autoClose: false,
        highWaterMark: 64 * 1024,
      })) {
        const bytes = chunk as Buffer;
        length += bytes.length;
        hash.update(bytes);
        yield bytes;
      }
    }
    if (length !== source.byteLength || hash.digest("hex") !== source.sha256)
      throw new Error("Historical source integrity failed.");
  } finally {
    await handle.close();
  }
}

async function inspect(
  root: string,
  path: string,
  prefix?: number,
): Promise<{ byteLength: number; sha256: string; physicalLength: number }> {
  if (prefix === 0) {
    // A zero-byte acknowledged upload need not have created a physical file yet.
    try {
      await lstat(await sourcePath(root, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { byteLength: 0, physicalLength: 0, sha256: createHash("sha256").digest("hex") };
      throw error;
    }
  }
  const handle = await open(
    await sourcePath(root, path),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    const length = prefix ?? stat.size;
    if (!stat.isFile() || !Number.isSafeInteger(length) || length < 0 || stat.size < length)
      throw new Error("Historical source length is invalid.");
    const hash = createHash("sha256");
    let received = 0;
    if (length > 0)
      for await (const chunk of handle.createReadStream({
        start: 0,
        end: length - 1,
        autoClose: false,
        highWaterMark: 64 * 1024,
      })) {
        received += (chunk as Buffer).length;
        hash.update(chunk as Buffer);
      }
    if (received !== length) throw new Error("Historical source changed during inventory.");
    return { byteLength: length, physicalLength: stat.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

/** Caller excludes file writers for the capture; private locators belong only in sealed records. */
export async function inventoryLegacyFileSources(
  db: Database | Transaction,
  root: string,
): Promise<LegacyFileSource[]> {
  const sources: LegacyFileSource[] = [];
  const known = new Set<string>();
  for (const row of await db.select().from(schema.fileContents)) {
    if (row.storageFormat !== "legacy-v1") continue;
    if (row.storageKey === null || row.sha256 === null)
      throw new Error("Invalid historical content metadata.");
    const path = `${row.storageKey.slice(0, 2)}/${row.storageKey}`;
    const physical = await inspect(root, path);
    if (
      physical.byteLength !== row.byteLength ||
      physical.sha256 !== Buffer.from(row.sha256).toString("hex")
    )
      throw new Error("Historical content does not match its recorded digest.");
    sources.push({
      kind: "content",
      objectId: row.id,
      path,
      byteLength: row.byteLength,
      sha256: physical.sha256,
      referenceCount: row.referenceCount,
    });
    known.add(path);
  }
  for (const table of [
    schema.protectedBlobChunks,
    schema.protectedUploadChunks,
    schema.protectedFileQuarantine,
  ]) {
    for (const row of await db.select({ storageKey: table.storageKey }).from(table))
      if (row.storageKey !== null) known.add(`${row.storageKey.slice(0, 2)}/${row.storageKey}`);
  }
  for (const row of await db
    .select()
    .from(schema.uploads)
    .where(eq(schema.uploads.storageFormat, "legacy-v1"))) {
    const path = `uploads/${row.id}`;
    const physical = await inspect(root, path, row.receivedLength);
    sources.push({
      kind: "upload",
      objectId: row.id,
      path,
      byteLength: row.receivedLength,
      sha256: physical.sha256,
      declaredLength: row.declaredLength,
      expiresAt: row.expiresAt.toISOString(),
      metadata: { originalName: row.originalName, mediaType: row.mediaType },
    });
    // Retain unacknowledged tails in quarantine before retiring the source file.
    if (physical.physicalLength === physical.byteLength) known.add(path);
  }
  let directories: string[];
  try {
    directories = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return sources;
    throw error;
  }
  for (const directory of directories) {
    if (directory !== "uploads" && !/^[0-9a-f]{2}$/.test(directory))
      throw new Error("Unsupported historical storage directory.");
    const metadata = await lstat(join(root, directory));
    if (!metadata.isDirectory() || metadata.isSymbolicLink())
      throw new Error("Unsafe historical storage directory.");
    for (const basename of await readdir(join(root, directory))) {
      const path = `${directory}/${basename}`;
      if (known.has(path)) continue;
      const physical = await inspect(root, path);
      sources.push({
        kind: "orphan",
        objectId: generateUuidV7(),
        path,
        byteLength: physical.byteLength,
        sha256: physical.sha256,
      });
    }
  }
  return sources.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.objectId.localeCompare(b.objectId),
  );
}
