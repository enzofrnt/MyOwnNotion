/** Authenticated outcomes beside the archives, independent of application tables. */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { isUuid } from "@myownnotion/domain";
import { open as decrypt, seal } from "@myownnotion/domain/security";

const AAD = Buffer.from("myownnotion.full-backup.receipt.v1");
export interface FullBackupReceipt {
  readonly formatVersion: 1;
  readonly backupId: string;
  readonly createdAt: string;
  readonly verifiedAt: string;
  readonly sourceVersion: string | null;
  readonly reason: "manual" | "scheduled" | "pre-update";
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly remote: "not-configured" | "pending" | "verified" | "failed";
  readonly remoteVerifiedAt: string | null;
}

export function fullArchiveName(backupId: string): string {
  if (!isUuid(backupId)) throw new Error("Invalid complete-backup identity.");
  return `${backupId}.monfull`;
}

function receipt(value: unknown): FullBackupReceipt {
  if (value === null || typeof value !== "object") throw new Error("Invalid full-backup receipt.");
  const row = value as Record<string, unknown>;
  const date = (value: unknown) =>
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
  if (
    row["formatVersion"] !== 1 ||
    !isUuid(row["backupId"]) ||
    !date(row["createdAt"]) ||
    !date(row["verifiedAt"]) ||
    !(row["sourceVersion"] === null || typeof row["sourceVersion"] === "string") ||
    !["manual", "scheduled", "pre-update"].includes(String(row["reason"])) ||
    !Number.isSafeInteger(row["archiveBytes"]) ||
    Number(row["archiveBytes"]) <= 0 ||
    typeof row["archiveSha256"] !== "string" ||
    !/^[0-9a-f]{64}$/.test(row["archiveSha256"]) ||
    !["not-configured", "pending", "verified", "failed"].includes(String(row["remote"])) ||
    !(row["remoteVerifiedAt"] === null || date(row["remoteVerifiedAt"])) ||
    (row["remote"] === "verified") !== (row["remoteVerifiedAt"] !== null)
  ) {
    throw new Error("Invalid full-backup receipt.");
  }
  return value as FullBackupReceipt;
}

export class FullBackupReceipts {
  constructor(
    private readonly root: string,
    private readonly key: () => Uint8Array,
  ) {}

  async put(value: FullBackupReceipt): Promise<void> {
    const checked = receipt(value);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const clear = Buffer.from(JSON.stringify(checked));
    let key: Buffer | undefined;
    let bytes: Buffer;
    try {
      key = Buffer.from(this.key());
      const encrypted = seal(key, clear, AAD);
      bytes = Buffer.concat([
        Buffer.from(encrypted.nonce),
        Buffer.from(encrypted.tag),
        Buffer.from(encrypted.ciphertext),
      ]);
    } finally {
      clear.fill(0);
      key?.fill(0);
    }
    const target = join(this.root, `${checked.backupId}.receipt`);
    const temporary = join(this.root, `.receipt-${randomUUID()}`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
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

  async list(): Promise<FullBackupReceipt[]> {
    return (await this.scan()).receipts;
  }

  async remove(backupId: string): Promise<void> {
    fullArchiveName(backupId);
    await rm(join(this.root, `${backupId}.receipt`), { force: true });
  }

  async scan(): Promise<{ receipts: FullBackupReceipt[]; invalidCount: number }> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { receipts: [], invalidCount: 0 };
      throw error;
    }
    const results: FullBackupReceipt[] = [];
    let invalidCount = 0;
    for (const name of names.filter((name) => name.endsWith(".receipt"))) {
      try {
        const id = name.slice(0, -8);
        fullArchiveName(id);
        const handle = await open(join(this.root, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes: Buffer;
        try {
          const metadata = await handle.stat();
          if (!metadata.isFile() || metadata.size < 28 || metadata.size > 16_384)
            throw new Error("Invalid encrypted backup receipt size.");
          bytes = await handle.readFile();
        } finally {
          await handle.close();
        }
        const key = Buffer.from(this.key());
        let clear: Uint8Array | undefined;
        try {
          clear = decrypt(
            key,
            {
              nonce: bytes.subarray(0, 12),
              tag: bytes.subarray(12, 28),
              ciphertext: bytes.subarray(28),
            },
            AAD,
          );
          const checked = receipt(JSON.parse(Buffer.from(clear).toString("utf8")));
          if (checked.backupId !== id)
            throw new Error("A backup receipt identity does not match its file.");
          results.push(checked);
        } finally {
          key.fill(0);
          clear?.fill(0);
        }
      } catch {
        invalidCount += 1;
      }
    }
    return {
      receipts: results.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      invalidCount,
    };
  }
}
