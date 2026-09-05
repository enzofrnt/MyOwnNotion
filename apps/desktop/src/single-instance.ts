import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export function acquireSingleInstanceLock(lockDirectory: string): boolean {
  mkdirSync(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, "instance.lock");
  if (existsSync(lockPath)) {
    return false;
  }
  writeFileSync(lockPath, String(process.pid), { encoding: "utf8", flag: "wx" });
  return true;
}

export function releaseSingleInstanceLock(lockDirectory: string): void {
  rmSync(path.join(lockDirectory, "instance.lock"), { force: true });
}
