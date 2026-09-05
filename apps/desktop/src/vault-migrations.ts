/** Native vault format guard. IndexedDB migrations remain owned by client-core's Dexie schema. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const CURRENT_VAULT_SCHEMA = 1;
export interface VaultFormat {
  schemaVersion: number;
}

/** No destructive implicit migration: unknown, interrupted or corrupt formats fail closed. */
export async function ensureVaultFormat(directory: string): Promise<void> {
  const file = path.join(directory, "vault-format.json");
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      (value as VaultFormat).schemaVersion !== CURRENT_VAULT_SCHEMA
    )
      throw new Error("Unsupported native vault format");
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify({ schemaVersion: CURRENT_VAULT_SCHEMA }), {
    mode: 0o600,
  });
  await rename(temporary, file);
}
