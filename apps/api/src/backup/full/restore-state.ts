/** A restored data directory cannot serve old sessions before explicit activation. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isUuid } from "@myownnotion/domain";
import { open as decrypt, seal } from "@myownnotion/domain/security";

export const FULL_RESTORE_MARKER = ".full-restore-state";
const AAD = Buffer.from("myownnotion.full-backup.restore-state.v1");
export interface FullRestoreState {
  readonly formatVersion: 1;
  readonly backupId: string;
  readonly stage: "incomplete" | "data-restored";
  readonly databaseName: string;
  readonly databaseOid: number;
  readonly clusterId: string;
}

export async function assertFullRestoreActivated(blobRoot: string): Promise<void> {
  try {
    await lstat(join(blobRoot, FULL_RESTORE_MARKER));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    "A full restoration is incomplete or awaits local security activation. The server cannot start.",
  );
}

export async function writeFullRestoreState(
  root: string,
  value: FullRestoreState,
  key: Uint8Array,
): Promise<void> {
  const clear = Buffer.from(JSON.stringify(value));
  const temporary = join(root, `.restore-state-${randomUUID()}`);
  try {
    const envelope = seal(key, clear, AAD);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(
        Buffer.concat([
          Buffer.from(envelope.nonce),
          Buffer.from(envelope.tag),
          Buffer.from(envelope.ciphertext),
        ]),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, join(root, FULL_RESTORE_MARKER));
    const directory = await open(root, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    clear.fill(0);
    await rm(temporary, { force: true });
  }
}

export async function readFullRestoreState(
  root: string,
  key: Uint8Array,
): Promise<FullRestoreState> {
  const handle = await open(
    join(root, FULL_RESTORE_MARKER),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 28 || metadata.size > 16_384)
      throw new Error("Invalid full-restore marker.");
    const bytes = await handle.readFile();
    const clear = decrypt(
      key,
      { nonce: bytes.subarray(0, 12), tag: bytes.subarray(12, 28), ciphertext: bytes.subarray(28) },
      AAD,
    );
    try {
      const value = JSON.parse(Buffer.from(clear).toString("utf8")) as Record<string, unknown>;
      if (
        value === null ||
        typeof value !== "object" ||
        value["formatVersion"] !== 1 ||
        !isUuid(value["backupId"]) ||
        !["incomplete", "data-restored"].includes(String(value["stage"])) ||
        typeof value["databaseName"] !== "string" ||
        !Number.isSafeInteger(value["databaseOid"]) ||
        typeof value["clusterId"] !== "string" ||
        !/^[0-9]+$/.test(value["clusterId"])
      ) {
        throw new Error("Invalid full-restore marker.");
      }
      return value as unknown as FullRestoreState;
    } finally {
      clear.fill(0);
    }
  } finally {
    await handle.close();
  }
}
