/** Capture durable blobs and exactly the upload prefixes committed in the snapshot. */
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type FullBackupComponent, isUuid, validFullComponentPath } from "@myownnotion/domain";
import type pg from "pg";
import { componentAad, sealFullStream } from "./crypto.ts";

interface DurableFile {
  readonly kind: "blob" | "upload";
  readonly path: string;
  readonly length?: number;
}

async function tableExists(client: pg.Client, table: string): Promise<boolean> {
  return (
    (
      await client.query<{ present: boolean }>("SELECT to_regclass($1) IS NOT NULL AS present", [
        `public.${table}`,
      ])
    ).rows[0]?.present === true
  );
}

async function inventory(client: pg.Client, root: string): Promise<DurableFile[]> {
  const files: DurableFile[] = [];
  const blobs = new Set<string>();
  let entries: string[];
  try {
    if (!(await lstat(root)).isDirectory())
      throw new Error("The blob root must be a real directory.");
    entries = await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    entries = [];
  }
  for (const name of entries) {
    if (name === "uploads") {
      if (!(await lstat(join(root, name))).isDirectory())
        throw new Error("The upload directory must not be a symlink.");
      continue;
    }
    if (!/^[0-9a-f]{2}$/.test(name) || !(await lstat(join(root, name))).isDirectory()) {
      throw new Error("The blob root contains an unsupported entry; the full backup is refused.");
    }
    for (const basename of await readdir(join(root, name))) {
      // Uncommitted atomic blob writes have no durable identity yet.
      if (/^\.tmp-[0-9a-f]{16}$/.test(basename)) continue;
      const path = `${name}/${basename}`;
      if (!validFullComponentPath("blob", path))
        throw new Error("The blob store contains an invalid durable path.");
      files.push({ kind: "blob", path });
      blobs.add(basename);
    }
  }
  for (const table of [
    "file_contents",
    "protected_blob_chunks",
    "protected_upload_chunks",
    "protected_file_quarantine",
  ]) {
    if (!(await tableExists(client, table))) continue;
    // Only these fixed relation names are interpolated, never archive input.
    const references = await client.query<{ storage_key: string }>(
      `SELECT DISTINCT storage_key FROM public.${table} WHERE storage_key IS NOT NULL`,
    );
    if (references.rows.some((row) => !blobs.has(row.storage_key))) {
      throw new Error("A database-referenced blob is missing; the full backup is refused.");
    }
  }
  if (await tableExists(client, "uploads")) {
    const hasFormat =
      (
        await client.query<{ present: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'uploads' AND column_name = 'storage_format') AS present",
        )
      ).rows[0]?.present === true;
    const uploads = await client.query<{
      id: string;
      received_length: string;
      storage_format: string;
    }>(
      `SELECT id, received_length, ${hasFormat ? "storage_format" : "'legacy-v1' AS storage_format"} FROM public.uploads ORDER BY id`,
    );
    for (const upload of uploads.rows) {
      const length = Number(upload.received_length);
      if (!isUuid(upload.id) || !Number.isSafeInteger(length) || length < 0)
        throw new Error("The committed upload inventory is invalid.");
      if (upload.storage_format === "encrypted-chunks-v1") continue;
      if (upload.storage_format !== "legacy-v1")
        throw new Error("Unsupported upload storage format.");
      files.push({ kind: "upload", path: `uploads/${upload.id}`, length });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

async function* plaintext(root: string, file: DurableFile): AsyncGenerator<Uint8Array> {
  if (file.length === 0) return;
  const handle = await open(join(root, file.path), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error("A durable blob must be a regular file.");
    const length = file.length ?? metadata.size;
    if (metadata.size < length) throw new Error("A committed upload prefix is missing bytes.");
    if (length === 0) return;
    let received = 0;
    for await (const chunk of handle.createReadStream({
      start: 0,
      end: length - 1,
      autoClose: false,
    })) {
      const bytes = chunk as Buffer;
      received += bytes.byteLength;
      yield bytes;
    }
    if (received !== length) throw new Error("A durable file changed during capture.");
  } finally {
    await handle.close();
  }
}

/** Caller holds the file locks and exported snapshot throughout capture. */
export async function captureFullFiles(input: {
  client: pg.Client;
  blobRoot: string;
  stagingDirectory: string;
  backupId: string;
  key: Uint8Array;
}): Promise<{ components: FullBackupComponent[]; encryptedPaths: string[] }> {
  const components: FullBackupComponent[] = [];
  const encryptedPaths: string[] = [];
  for (const file of await inventory(input.client, input.blobRoot)) {
    const index = components.length + 1;
    const destination = join(input.stagingDirectory, `component-${index}`);
    const metadata = await sealFullStream(
      plaintext(input.blobRoot, file),
      input.key,
      componentAad(input.backupId, index, file.path),
      destination,
    );
    if (file.kind === "blob" && metadata.sha256 !== file.path.slice(3)) {
      throw new Error("A durable blob does not match its content address.");
    }
    components.push({ kind: file.kind, path: file.path, ...metadata });
    encryptedPaths.push(destination);
  }
  return { components, encryptedPaths };
}
