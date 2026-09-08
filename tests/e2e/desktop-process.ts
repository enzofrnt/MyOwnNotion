import { type ChildProcess, execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function forceProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) throw new Error("Missing native test process identity");
  if (process.platform === "win32") {
    await promisify(execFile)("taskkill", ["/pid", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 10_000,
    });
  } else child.kill("SIGKILL");
}

function observeExit(child: ChildProcess, timeout: number) {
  let dispose = () => {};
  const exited = new Promise<boolean>((resolve) => {
    if (hasExited(child)) {
      resolve(true);
      return;
    }
    const done = () => {
      dispose();
      resolve(true);
    };
    const timer = setTimeout(() => {
      dispose();
      resolve(false);
    }, timeout);
    dispose = () => {
      clearTimeout(timer);
      child.off("exit", done);
    };
    child.once("exit", done);
  });
  return { exited, dispose: () => dispose() };
}

export async function crashProcess(
  child: ChildProcess,
  force: (child: ChildProcess) => Promise<void> = forceProcess,
): Promise<void> {
  if (hasExited(child)) return;
  // Subscribe before termination: OS process death and the runtime's exit
  // notification are not atomic. A racing taskkill failure alone proves neither.
  const observer = observeExit(child, 10_000);
  let terminationError: unknown;
  try {
    try {
      await force(child);
    } catch (error) {
      terminationError = error;
    }
    if (!(await observer.exited)) {
      throw (
        terminationError ?? new Error("Native test process did not exit after forced termination")
      );
    }
  } finally {
    observer.dispose();
  }
}

export async function closeProcess(
  child: ChildProcess,
  close: () => Promise<void>,
  force: (child: ChildProcess) => Promise<void> = forceProcess,
): Promise<void> {
  if (hasExited(child)) return;
  const observer = observeExit(child, 5000);
  try {
    // Closing the browser channel can precede the owned OS process notification.
    // Give normal shutdown its existing budget before resorting to forced exit.
    void Promise.resolve()
      .then(close)
      .catch(() => {});
    if (!(await observer.exited)) await crashProcess(child, force);
  } finally {
    observer.dispose();
  }
}

export async function removeProfile(directory: string, remove: typeof rm = rm): Promise<void> {
  // Bun 1.4.0 parses rm retry options but does not use them for recursive
  // deletion. Apply the same bounded policy here; never suppress a lasting lock.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await remove(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
      if (
        attempt >= 10 ||
        !["EBUSY", "EPERM", "ENOTEMPTY", "EMFILE", "ENFILE"].includes(String(code))
      )
        throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, (attempt + 1) * 100));
    }
  }
}
