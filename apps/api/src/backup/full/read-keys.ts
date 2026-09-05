/** External, bounded recovery keys. Callers own and clear every returned buffer. */
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadDeploymentKey } from "../../security/deployment-key.ts";

export const MAX_HISTORICAL_BACKUP_KEYS = 16;

export function historicalBackupKeyFiles(raw: string | undefined): readonly string[] {
  const invalid = () =>
    new Error(
      "MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES must be a bounded JSON array of unique absolute secret-file paths.",
    );
  if (raw === undefined) return [];
  if (Buffer.byteLength(raw) > 16_384) throw invalid();
  if (raw.trim() === "") return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(value) ||
    value.length > MAX_HISTORICAL_BACKUP_KEYS ||
    value.some(
      (path) =>
        typeof path !== "string" || path.length > 4096 || path.includes("\0") || !isAbsolute(path),
    )
  )
    throw invalid();
  const paths = (value as string[]).map((path) => resolve(path));
  if (new Set(paths).size !== paths.length) throw invalid();
  return paths;
}

/** Canonicalize even not-yet-created storage roots through their existing parents. */
function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return resolve(canonicalPath(parent), relative(parent, absolute));
  }
}

export function loadHistoricalBackupKeys(
  files: readonly string[],
  storageRoots: readonly string[],
): Buffer[] {
  historicalBackupKeyFiles(JSON.stringify(files));
  const keys: Buffer[] = [];
  try {
    const roots = files.length === 0 ? [] : storageRoots.map(canonicalPath);
    const seen = new Set<string>();
    for (const file of files) {
      const actual = realpathSync(file);
      if (
        seen.has(actual) ||
        roots.some((root) => {
          const path = relative(root, actual);
          return (
            path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
          );
        })
      )
        throw new Error(
          "Historical backup keys must be distinct external secret files outside data and backup storage.",
        );
      seen.add(actual);
      if (statSync(actual).size > 4096)
        throw new Error("Historical backup key files must not exceed 4096 bytes.");
      const loaded = loadDeploymentKey(actual);
      try {
        keys.push(Buffer.from(loaded.bytes));
      } finally {
        loaded.bytes.fill(0);
      }
    }
    return keys;
  } catch (error) {
    for (const key of keys) key.fill(0);
    throw error;
  }
}

export function loadBackupReadKeys(
  current: () => Uint8Array,
  files: readonly string[] = [],
  roots: readonly string[] = [],
): Buffer[] {
  const keys = loadHistoricalBackupKeys(files, roots);
  try {
    return [Buffer.from(current()), ...keys];
  } catch (error) {
    for (const key of keys) key.fill(0);
    throw error;
  }
}

/** Try only authenticated decryption; schema validation remains outside fallback. */
export function authenticateWithBackupKeys<T>(
  keys: readonly Uint8Array[],
  open: (key: Uint8Array) => T,
): { key: Uint8Array; value: T } {
  for (const key of keys) {
    try {
      return { key, value: open(key) };
    } catch {
      /* Try the next explicitly supplied key. */
    }
  }
  throw new Error("No configured backup key authenticated this recovery record.");
}
