import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { crc32 } from "node:zlib";
import * as yauzl from "yauzl";

export class NotionImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const SOURCE_LIMITS = {
  entries: 10_000,
  depth: 32,
  textBytes: 8 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 256 * 1024 * 1024,
  ratio: 100,
} as const;
export interface SourceFile {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}
export interface ImportSnapshot {
  files: SourceFile[];
  directories?: string[];
  digest: string;
  totalBytes: number;
}
export function digest(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function normalizeSourcePath(raw: string): string {
  const path = raw.normalize("NFC");
  if (
    !path ||
    path.includes("\\") ||
    [...path].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /^[/]|^[a-z]:/i.test(path)
  )
    throw new NotionImportError("import.unsafe-path");
  const parts = path.replace(/\/$/, "").split("/");
  if (
    parts.some((part) => !part || part === "." || part === "..") ||
    parts.length > SOURCE_LIMITS.depth
  )
    throw new NotionImportError("import.unsafe-path");
  return parts.join("/");
}
const isText = (path: string) => [".md", ".csv", ".base"].includes(extname(path).toLowerCase());
function assertSize(path: string, bytes: number) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > (isText(path) ? SOURCE_LIMITS.textBytes : SOURCE_LIMITS.fileBytes)
  )
    throw new NotionImportError("import.source-too-large");
}
async function readRegular(path: string, limit: number): Promise<Uint8Array> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new NotionImportError("import.unsafe-source");
    const chunks: Buffer[] = [];
    let count = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      count += chunk.length;
      if (count > limit) throw new NotionImportError("import.source-too-large");
      chunks.push(chunk);
    }
    const after = await file.stat();
    if (stat.size !== count || stat.mtimeMs !== after.mtimeMs || stat.size !== after.size)
      throw new NotionImportError("import.source-changed");
    return Buffer.concat(chunks);
  } finally {
    await file.close();
  }
}
export async function readImportSource(sourcePath: string): Promise<ImportSnapshot> {
  const source = resolve(sourcePath);
  const rootStat = await lstat(source);
  if (rootStat.isSymbolicLink()) throw new NotionImportError("import.symlink-refused");
  const files: SourceFile[] = [];
  const names = new Set<string>();
  const directories = new Set<string>();
  let entries = 0;
  let totalBytes = 0;
  const register = (raw: string, size: number) => {
    if (++entries > SOURCE_LIMITS.entries) throw new NotionImportError("import.too-many-entries");
    const path = normalizeSourcePath(raw);
    const key = path.toLowerCase();
    if (names.has(key)) throw new NotionImportError("import.duplicate-path");
    names.add(key);
    assertSize(path, size);
    totalBytes += size;
    if (totalBytes > SOURCE_LIMITS.totalBytes)
      throw new NotionImportError("import.source-too-large");
    return path;
  };
  const accept = (path: string, bytes: Uint8Array) => {
    files.push({ path, bytes, sha256: digest(bytes) });
  };
  if (rootStat.isDirectory()) {
    const root = await realpath(source);
    const assertContained = async (path: string) => {
      const actual = await realpath(path);
      if (actual !== root && !actual.startsWith(`${root}${sep}`))
        throw new NotionImportError("import.unsafe-path");
    };
    const walk = async (directory: string, depth: number) => {
      if (depth > SOURCE_LIMITS.depth) throw new NotionImportError("import.unsafe-path");
      await assertContained(directory);
      for (const name of (await readdir(directory)).sort()) {
        const path = join(directory, name);
        const info = await lstat(path);
        if (info.isSymbolicLink()) throw new NotionImportError("import.symlink-refused");
        await assertContained(path);
        if (info.isDirectory()) {
          directories.add(register(relative(root, path).split(sep).join("/"), 0));
          await walk(path, depth + 1);
        } else if (info.isFile()) {
          const normalized = register(relative(root, path).split(sep).join("/"), info.size);
          const bytes = await readRegular(path, Math.min(info.size, SOURCE_LIMITS.fileBytes));
          await assertContained(path);
          if (bytes.length !== info.size) throw new NotionImportError("import.source-changed");
          accept(normalized, bytes);
        } else throw new NotionImportError("import.unsafe-source");
      }
    };
    await walk(root, 0);
  } else if (rootStat.isFile() && extname(source).toLowerCase() === ".zip") {
    const archive = await readRegular(source, SOURCE_LIMITS.fileBytes);
    const zip = await new Promise<yauzl.ZipFile>((resolveZip, reject) =>
      yauzl.fromBuffer(
        Buffer.from(archive),
        { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
        (error, value) => {
          if (error || !value) reject(new NotionImportError("import.invalid-archive"));
          else resolveZip(value);
        },
      ),
    );
    try {
      await new Promise<void>((resolveEntries, rejectEntries) => {
        const fail = (error: unknown) => {
          zip.close();
          rejectEntries(
            error instanceof NotionImportError
              ? error
              : new NotionImportError("import.invalid-archive"),
          );
        };
        zip.on("error", fail);
        zip.on("end", resolveEntries);
        zip.on("entry", (entry: yauzl.Entry) => {
          void (async () => {
            const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000)
              throw new NotionImportError("import.symlink-refused");
            if ((entry.generalPurposeBitFlag & 1) !== 0)
              throw new NotionImportError("import.encrypted-archive-refused");
            const path = register(entry.fileName, entry.uncompressedSize);
            if (entry.uncompressedSize > Math.max(1, entry.compressedSize) * SOURCE_LIMITS.ratio)
              throw new NotionImportError("import.archive-ratio-exceeded");
            if (entry.fileName.endsWith("/")) {
              if (entry.uncompressedSize !== 0)
                throw new NotionImportError("import.invalid-archive");
              directories.add(path);
            } else {
              const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, reject) =>
                zip.openReadStream(entry, (error, value) => {
                  if (error || !value) reject(error);
                  else resolveStream(value);
                }),
              );
              const chunks: Uint8Array[] = [];
              let size = 0;
              for await (const chunk of stream as AsyncIterable<Buffer>) {
                size += chunk.length;
                if (size > entry.uncompressedSize)
                  throw new NotionImportError("import.source-too-large");
                chunks.push(chunk);
              }
              if (size !== entry.uncompressedSize)
                throw new NotionImportError("import.invalid-archive");
              const bytes = Buffer.concat(chunks);
              if (crc32(bytes) !== entry.crc32)
                throw new NotionImportError("import.archive-integrity-failed");
              accept(path, bytes);
            }
            zip.readEntry();
          })().catch(fail);
        });
        zip.readEntry();
      });
    } finally {
      zip.close();
    }
  } else throw new NotionImportError("import.unsupported-source");
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of files) {
    const parts = file.path.split("/");
    for (let length = 1; length < parts.length; length++)
      directories.add(parts.slice(0, length).join("/"));
  }
  const sortedDirectories = [...directories].sort();
  return {
    files,
    directories: sortedDirectories,
    totalBytes,
    digest: digest(
      JSON.stringify({
        files: files.map(({ path, sha256, bytes }) => [path, sha256, bytes.length]),
        directories: sortedDirectories,
      }),
    ),
  };
}
export function sourceText(file: SourceFile): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file.bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new NotionImportError("import.invalid-utf8");
  }
}
