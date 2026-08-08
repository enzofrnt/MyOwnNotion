import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createSafeOperationResult, type SafeOperationResult } from "./result.ts";

const MAX_STATUS_BYTE_LENGTH = 65_536;

export async function writeOperationStatus(
  statusPath: string,
  status: SafeOperationResult,
): Promise<void> {
  const directory = path.dirname(statusPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const serialized = `${JSON.stringify(status)}\n`;
  if (Buffer.byteLength(serialized) > MAX_STATUS_BYTE_LENGTH) {
    throw new RangeError("operation status exceeds the safe size limit");
  }
  const temporaryPath = path.join(directory, `.${path.basename(statusPath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, statusPath);
    await chmod(statusPath, 0o600);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function readOperationStatus(statusPath: string): Promise<SafeOperationResult | null> {
  let serialized: string;
  try {
    serialized = await readFile(statusPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (Buffer.byteLength(serialized) > MAX_STATUS_BYTE_LENGTH) {
    throw new RangeError("operation status exceeds the safe size limit");
  }
  return createSafeOperationResult(
    JSON.parse(serialized) as Record<string, unknown> & {
      operationId: unknown;
      command: unknown;
      status: unknown;
      startedAt: unknown;
      finishedAt: unknown;
      counts: unknown;
      failureCode: unknown;
    },
  );
}
