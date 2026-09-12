/** Small encrypted operational records; these never substitute for verified archives. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isUuid } from "@myownnotion/domain";
import { open as decrypt, seal } from "@myownnotion/domain/security";

import { authenticateWithBackupKeys } from "./read-keys.ts";

export interface FullBackupActivity {
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly outcome: "running" | "succeeded" | "failed";
  readonly backupId: string | null;
}
type ActivityKind = "backup" | "rehearsal";

function activity(value: unknown): FullBackupActivity {
  if (value === null || typeof value !== "object") throw new Error("Invalid backup activity.");
  const row = value as Record<string, unknown>;
  const date = (input: unknown) =>
    typeof input === "string" &&
    Number.isFinite(Date.parse(input)) &&
    new Date(input).toISOString() === input;
  if (
    !date(row["startedAt"]) ||
    !(row["finishedAt"] === null || date(row["finishedAt"])) ||
    !["running", "succeeded", "failed"].includes(String(row["outcome"])) ||
    (row["outcome"] === "running") !== (row["finishedAt"] === null) ||
    !(row["backupId"] === null || isUuid(row["backupId"]))
  )
    throw new Error("Invalid backup activity.");
  return value as FullBackupActivity;
}

export class FullBackupActivities {
  constructor(
    private readonly root: string,
    private readonly key: () => Uint8Array,
    private readonly readKeys: () => Buffer[] = () => [Buffer.from(key())],
  ) {}

  async read(kind: ActivityKind): Promise<FullBackupActivity | null> {
    const keys = this.readKeys();
    try {
      let handle: FileHandle;
      try {
        handle = await open(
          join(this.root, `.full-${kind}-activity`),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      let clear: Uint8Array | undefined;
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.size < 28 || metadata.size > 4096)
          throw new Error("Invalid backup activity size.");
        const bytes = await handle.readFile();
        clear = authenticateWithBackupKeys(keys, (key) =>
          decrypt(
            key,
            {
              nonce: bytes.subarray(0, 12),
              tag: bytes.subarray(12, 28),
              ciphertext: bytes.subarray(28),
            },
            Buffer.from(`myownnotion.full-backup.activity.v1:${kind}`),
          ),
        ).value;
        return activity(JSON.parse(Buffer.from(clear).toString("utf8")));
      } finally {
        clear?.fill(0);
        await handle.close();
      }
    } finally {
      for (const key of keys) key.fill(0);
    }
  }

  /** Caller serializes operations with the database-local full-run lock. */
  async put(kind: ActivityKind, value: FullBackupActivity): Promise<void> {
    const clear = Buffer.from(JSON.stringify(activity(value)));
    let key: Buffer | undefined;
    let bytes: Buffer;
    try {
      key = Buffer.from(this.key());
      const encrypted = seal(
        key,
        clear,
        Buffer.from(`myownnotion.full-backup.activity.v1:${kind}`),
      );
      bytes = Buffer.concat([
        Buffer.from(encrypted.nonce),
        Buffer.from(encrypted.tag),
        Buffer.from(encrypted.ciphertext),
      ]);
    } finally {
      clear.fill(0);
      key?.fill(0);
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = join(this.root, `.activity-${randomUUID()}`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.root, `.full-${kind}-activity`));
      const directory = await open(this.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
