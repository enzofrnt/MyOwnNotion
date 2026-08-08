import { spawn } from "node:child_process";

export interface ExternalProcessOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly failureCode: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxOutputByteLength?: number;
}

export type ExternalProcessResult =
  | { readonly ok: true; readonly exitCode: 0 }
  | { readonly ok: false; readonly exitCode: number | null; readonly failureCode: string };

export type ExternalJsonProcessResult<T> =
  | { readonly ok: true; readonly exitCode: 0; readonly value: T }
  | { readonly ok: false; readonly exitCode: number | null; readonly failureCode: string };

/** Executes without a shell and drains bounded private output without returning it. */
export async function runExternalProcess(
  options: ExternalProcessOptions,
): Promise<ExternalProcessResult> {
  const maxOutputByteLength = options.maxOutputByteLength ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxOutputByteLength) || maxOutputByteLength < 0) {
    throw new RangeError("process output limit is invalid");
  }
  return new Promise((resolve) => {
    const child = spawn(options.executable, [...options.arguments], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
    });
    let observedBytes = 0;
    let exceeded = false;
    const discard = (chunk: Buffer): void => {
      observedBytes += chunk.byteLength;
      if (!exceeded && observedBytes > maxOutputByteLength) {
        exceeded = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", discard);
    child.stderr.on("data", discard);
    child.once("error", () => {
      resolve({ ok: false, exitCode: null, failureCode: options.failureCode });
    });
    child.once("close", (code) => {
      if (code === 0 && !exceeded) {
        resolve({ ok: true, exitCode: 0 });
      } else {
        resolve({ ok: false, exitCode: code, failureCode: options.failureCode });
      }
    });
  });
}

/** Captures bounded stdout only long enough to validate a closed JSON result. */
export async function runExternalJsonProcess<T>(
  options: ExternalProcessOptions,
  parse: (value: unknown) => T,
): Promise<ExternalJsonProcessResult<T>> {
  const maxOutputByteLength = options.maxOutputByteLength ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxOutputByteLength) || maxOutputByteLength < 1) {
    throw new RangeError("process output limit is invalid");
  }
  return new Promise((resolve) => {
    const child = spawn(options.executable, [...options.arguments], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: { ...process.env, ...options.env } }),
    });
    const chunks: Buffer[] = [];
    let observedBytes = 0;
    let exceeded = false;
    const observe = (chunk: Buffer, retain: boolean): void => {
      observedBytes += chunk.byteLength;
      if (retain) chunks.push(chunk);
      if (!exceeded && observedBytes > maxOutputByteLength) {
        exceeded = true;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (chunk: Buffer) => observe(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => observe(chunk, false));
    child.once("error", () => {
      resolve({ ok: false, exitCode: null, failureCode: options.failureCode });
    });
    child.once("close", (code) => {
      if (code !== 0 || exceeded) {
        resolve({ ok: false, exitCode: code, failureCode: options.failureCode });
        return;
      }
      try {
        const serialized = Buffer.concat(chunks).toString("utf8").trim();
        resolve({ ok: true, exitCode: 0, value: parse(JSON.parse(serialized) as unknown) });
      } catch {
        resolve({ ok: false, exitCode: code, failureCode: options.failureCode });
      }
    });
  });
}
