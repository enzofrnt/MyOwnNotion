/** PostgreSQL client tools with bounded lifetimes and no credentials in argv. */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export function postgresToolEnvironment(connectionString: string): Record<string, string> {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("The database connection must be a PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2 ||
    !url.username
  ) {
    throw new Error("The PostgreSQL connection needs an explicit host, user and database.");
  }
  const env: Record<string, string> = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "TEMP", "SystemRoot", "SYSTEMROOT"]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "15",
    PGAPPNAME: "myownnotion-full-backup",
    LC_ALL: "C",
  });
  const parameters: Record<string, string> = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    channel_binding: "PGCHANNELBINDING",
    connect_timeout: "PGCONNECT_TIMEOUT",
  };
  for (const [name, value] of url.searchParams) {
    const variable = parameters[name];
    if (variable === undefined)
      throw new Error("Unsupported PostgreSQL connection option for complete backups.");
    env[variable] = value;
  }
  return env;
}

interface RunningTool {
  readonly child: ChildProcessWithoutNullStreams;
  readonly completion: Promise<{ code: number | null; failed: boolean }>;
  finish(): Promise<void>;
  stop(): Promise<void>;
}

export class PostgresFullBackupTools {
  constructor(private readonly options: { binDirectory?: string; timeoutMs?: number } = {}) {}

  private start(
    name: "pg_dump" | "pg_restore",
    args: readonly string[],
    connectionString: string,
  ): RunningTool {
    const executable =
      this.options.binDirectory === undefined
        ? name
        : join(this.options.binDirectory, process.platform === "win32" ? `${name}.exe` : name);
    const child = spawn(executable, [...args], {
      env: postgresToolEnvironment(connectionString),
      stdio: "pipe",
      windowsHide: true,
      shell: false,
    });
    let failed = false;
    let closed = false;
    // SQL diagnostics can contain private record values. Consume without logging.
    child.stderr.resume();
    const completion = new Promise<{ code: number | null; failed: boolean }>((resolve) => {
      child.once("error", () => {
        failed = true;
      });
      child.once("close", (code) => {
        closed = true;
        resolve({ code, failed });
      });
    });
    const timeout = setTimeout(
      () => {
        failed = true;
        child.kill("SIGKILL");
      },
      this.options.timeoutMs ?? 30 * 60_000,
    );
    timeout.unref();
    const finish = async () => {
      const outcome = await completion;
      clearTimeout(timeout);
      if (outcome.failed || outcome.code !== 0)
        throw new Error(
          `${name} did not complete successfully; no successful backup or restore is recorded.`,
        );
    };
    return {
      child,
      completion,
      finish,
      stop: async () => {
        clearTimeout(timeout);
        if (!closed) child.kill("SIGTERM");
        const force = setTimeout(() => {
          if (!closed) child.kill("SIGKILL");
        }, 2_000);
        force.unref();
        await completion;
        clearTimeout(force);
      },
    };
  }

  async checkVersions(connectionString: string): Promise<void> {
    for (const name of ["pg_dump", "pg_restore"] as const) {
      const run = this.start(name, ["--version"], connectionString);
      run.child.stdin.end();
      let output = "";
      try {
        for await (const chunk of run.child.stdout) {
          output += String(chunk);
          if (output.length > 1024) throw new Error("Unexpected PostgreSQL client version output.");
        }
        await run.finish();
        if (!new RegExp(`^${name} \\(PostgreSQL\\) 18\\.[0-9]+(?:[ \\r\\n]|$)`).test(output)) {
          throw new Error("Complete backups require PostgreSQL 18 client tools.");
        }
      } catch {
        throw new Error(`${name} did not complete its PostgreSQL 18 availability check.`);
      } finally {
        await run.stop();
      }
    }
  }

  async *dump(connectionString: string, snapshot: string): AsyncGenerator<Buffer> {
    if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(snapshot))
      throw new Error("Invalid PostgreSQL snapshot identifier.");
    const run = this.start(
      "pg_dump",
      ["--format=custom", "--no-password", "--lock-wait-timeout=30s", `--snapshot=${snapshot}`],
      connectionString,
    );
    run.child.stdin.end();
    try {
      for await (const bytes of run.child.stdout) yield bytes as Buffer;
      await run.finish();
    } finally {
      await run.stop();
    }
  }

  async restore(connectionString: string, input: AsyncIterable<Uint8Array>): Promise<void> {
    const run = this.start(
      "pg_restore",
      [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
        "--no-password",
        // An empty explicit database activates restore mode; libpq resolves
        // PGDATABASE. No user-supplied name can become a connection-string argv.
        "--dbname=",
      ],
      connectionString,
    );
    run.child.stdout.resume();
    try {
      await pipeline(Readable.from(input), run.child.stdin);
      await run.finish();
    } finally {
      await run.stop();
    }
  }
}
