import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, fsyncSync, openSync, readSync } from "node:fs";
import path from "node:path";

export const WINDOWS_KEY_PRIME_SWITCH = "myownnotion-prime-windows-key";
export const WINDOWS_SESSION_DATA_SWITCH = "myownnotion-key-session-data";
const MAX_LOCAL_STATE_BYTES = 4 * 1024 * 1024;

export function windowsProfileKeyEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === "ELECTRON_RUN_AS_NODE") delete environment[name];
  }
  return environment;
}

export class WindowsProfileKeyInitializationError extends Error {
  constructor(readonly exitStatus: number | null) {
    super("Windows protected storage initialization failed.");
  }
}

type PrimeRunner = (
  executable: string,
  args: readonly string[],
) => {
  readonly status: number | null;
  readonly error?: unknown;
};

/** Run before the parent Electron bootstrap completes and initializes OSCrypt. */
export function commitWindowsProfileKey(options: {
  readonly executable: string;
  readonly applicationPath?: string;
  readonly userData: string;
  readonly sessionData: string;
  readonly run?: PrimeRunner;
}): void {
  for (const value of [options.executable, options.userData, options.sessionData]) {
    if (!path.isAbsolute(value)) throw new Error("Protected storage paths must be absolute.");
  }
  if (options.applicationPath !== undefined && !path.isAbsolute(options.applicationPath)) {
    throw new Error("The application path must be absolute.");
  }
  const run: PrimeRunner =
    options.run ??
    ((executable, args) =>
      spawnSync(executable, [...args], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 20_000,
        env: windowsProfileKeyEnvironment(process.env),
      }));
  const result = run(options.executable, [
    ...(options.applicationPath === undefined ? [] : [options.applicationPath]),
    `--${WINDOWS_KEY_PRIME_SWITCH}`,
    `--user-data-dir=${options.userData}`,
    `--${WINDOWS_SESSION_DATA_SWITCH}=${options.sessionData}`,
  ]);
  if (result.error !== undefined || result.status !== 0) {
    throw new WindowsProfileKeyInitializationError(result.status);
  }

  // The child has exited and the parent owns the application lock. Chromium
  // has committed its own DPAPI-protected key; never generate or rewrite it here.
  const file = openSync(path.join(options.sessionData, "Local State"), "r+");
  try {
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_LOCAL_STATE_BYTES) {
      throw new Error("Invalid protected storage metadata.");
    }
    const bytes = Buffer.alloc(stat.size);
    const count = readSync(file, bytes, 0, bytes.length, 0);
    if (count !== bytes.length) throw new Error("Incomplete protected storage metadata.");
    const state = JSON.parse(bytes.toString("utf8")) as { os_crypt?: { encrypted_key?: unknown } };
    const key = state?.os_crypt?.encrypted_key;
    if (typeof key !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(key)) {
      throw new Error("Missing protected Windows key.");
    }
    const protectedKey = Buffer.from(key, "base64");
    if (protectedKey.length <= 5 || protectedKey.subarray(0, 5).toString("ascii") !== "DPAPI") {
      throw new Error("Invalid protected Windows key.");
    }
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
}
