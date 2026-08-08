import { type FileHandle, lstat, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

export interface LockOwner {
  readonly operationId: string;
  readonly startedAt: string;
}

export interface ExclusiveFileLock {
  readonly path: string;
  release(): Promise<void>;
}

export async function acquireExclusiveFileLock(
  lockPath: string,
  owner: LockOwner,
): Promise<ExclusiveFileLock | null> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
    const identity = await handle.stat();
    let released = false;
    return {
      path: lockPath,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        await handle.close();
        try {
          const current = await lstat(lockPath);
          if (current.dev === identity.dev && current.ino === identity.ino) {
            await rm(lockPath, { force: true });
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
      },
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true });
    throw error;
  }
}
