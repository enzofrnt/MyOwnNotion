import * as fs from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Reporter, TestModule } from "vitest/node";

export type DiagnosticReader = {
  lstat: (path: string) => fs.Stats;
  stat: (path: string) => fs.Stats;
  nativeRealpath: (path: string) => string;
  realpath: (path: string) => string;
};

const reader: DiagnosticReader = {
  lstat: (path) => fs.lstatSync(path),
  stat: (path) => fs.statSync(path),
  nativeRealpath: (path) => fs.realpathSync.native(path),
  realpath: (path) => fs.realpathSync(path),
};

function code(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function attempt(read: () => fs.Stats | string) {
  try {
    const result = read();
    return typeof result === "string"
      ? { code: null, exists: true, resolvedPath: result }
      : {
          code: null,
          exists: true,
          type: result.isSymbolicLink()
            ? "symlink"
            : result.isFile()
              ? "file"
              : result.isDirectory()
                ? "directory"
                : "other",
        };
  } catch (error) {
    const errorCode = code(error);
    return { code: errorCode, exists: errorCode === "ENOENT" ? false : null };
  }
}

/** Independent metadata reads only: no file contents, environment, or error messages. */
export function readLoaderDiagnostic(file: string, cwd = process.cwd(), reads = reader) {
  const absolutePath = resolve(cwd, file);
  const inspect = (path: string) => ({
    path,
    lstat: attempt(() => reads.lstat(path)),
    stat: attempt(() => reads.stat(path)),
    nativeRealpath: attempt(() => reads.nativeRealpath(path)),
    realpath: attempt(() => reads.realpath(path)),
  });
  const parents = [];
  for (let path = dirname(absolutePath); ; path = dirname(path)) {
    parents.push(inspect(path));
    if (dirname(path) === path) break;
  }
  return { cwd, module: inspect(absolutePath), parents };
}

function isEnoent(error: unknown, seen = new Set<unknown>()): boolean {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  if (code(error) === "ENOENT") return true;
  if ("message" in error && typeof error.message === "string" && /\bENOENT\b/.test(error.message))
    return true;
  return "cause" in error && isEnoent(error.cause, seen);
}

/** Vitest 5 collection errors, not individual test assertion failures. */
export default class LoaderDiagnosticsReporter implements Reporter {
  private readonly reported = new Set<string>();

  onTestRunStart(): void {
    this.reported.clear();
  }

  // Also inspect final collection errors; deduplication keeps one record per module.
  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    for (const module of modules) this.onTestModuleEnd(module);
  }

  constructor(
    _options: Record<string, never> = {},
    private readonly emit: (diagnostic: ReturnType<typeof readLoaderDiagnostic>) => void = (
      diagnostic,
    ) => {
      console.error(`[vitest-loader-diagnostics] ${JSON.stringify(diagnostic)}`);
    },
    private readonly read = readLoaderDiagnostic,
  ) {}

  onTestModuleEnd(module: Pick<TestModule, "moduleId" | "errors">): void {
    // Diagnostics must never replace the original failure or affect its outcome.
    try {
      if (
        this.reported.has(module.moduleId) ||
        !isAbsolute(module.moduleId) ||
        !module.errors().some((error) => isEnoent(error))
      )
        return;
      this.reported.add(module.moduleId);
      this.emit(this.read(module.moduleId));
    } catch {
      // A failed diagnostic callback is deliberately non-fatal.
    }
  }
}
