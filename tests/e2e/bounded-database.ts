import pg from "pg";

const MAX_DATABASE_ATTEMPTS = 3;
const DATABASE_QUERY_TIMEOUT_MS = 5_000;
const DATABASE_OPERATION_TIMEOUT_MS = 10_000;
const DATABASE_CLOSE_TIMEOUT_MS = 1_000;
const RETRYABLE_CODES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "55P03", // lock_not_available
  "57014", // query_canceled by statement_timeout
  "57P01", // admin_shutdown / recovered abandoned backend
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

function connectionString(): string {
  return (
    process.env["DATABASE_URL"] ??
    "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion"
  );
}

function postgresErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function isRetryable(error: unknown): boolean {
  const code = postgresErrorCode(error);
  if (code !== null && RETRYABLE_CODES.has(code)) return true;
  return (
    error instanceof Error &&
    /(?:query read timeout|connection terminated|timeout expired|client was closed)/iu.test(
      error.message,
    )
  );
}

interface PgClientWithDestroyableStream {
  readonly connection?: {
    readonly stream?: {
      destroy(): void;
    };
  };
}

/**
 * `pg.Client.end()` normally destroys an active query, but can wait forever
 * for the server's final socket event after all queries have completed. Bun's
 * Linux runtime exposed that wait only after long recycled-browser shards.
 * Destroying the owned fixture socket is safe here: every caller uses a
 * disposable client and retries idempotent work on a fresh connection.
 */
export function forceCloseDatabaseClient(client: pg.Client): void {
  const connection = (client as unknown as PgClientWithDestroyableStream).connection;
  connection?.stream?.destroy();
  void client.end().catch(() => undefined);
}

/** Never lets connection teardown consume Playwright's whole test timeout. */
export async function closeBoundedDatabaseClient(client: pg.Client): Promise<void> {
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const forcedClose = new Promise<void>((resolve) => {
    closeTimer = setTimeout(() => {
      forceCloseDatabaseClient(client);
      resolve();
    }, DATABASE_CLOSE_TIMEOUT_MS);
  });
  try {
    await Promise.race([client.end().catch(() => undefined), forcedClose]);
  } finally {
    if (closeTimer !== undefined) clearTimeout(closeTimer);
  }
}

/**
 * Runs an idempotent E2E database fixture with bounded connection, query,
 * lock, and whole-operation timeouts.
 *
 * Playwright cannot identify a direct PostgreSQL wait: without these bounds a
 * transient stalled socket consumes the entire test timeout and reports only
 * an opaque flaky test. Callers must keep `work` idempotent because a lost
 * response can leave a committed first attempt that the retry must safely
 * replace or upsert.
 */
export async function withBoundedDatabaseClient<T>(
  applicationName: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_DATABASE_ATTEMPTS; attempt += 1) {
    const client = new pg.Client({
      connectionString: connectionString(),
      application_name: applicationName,
      connectionTimeoutMillis: DATABASE_QUERY_TIMEOUT_MS,
      query_timeout: DATABASE_QUERY_TIMEOUT_MS,
      options: `-c statement_timeout=${DATABASE_QUERY_TIMEOUT_MS} -c lock_timeout=2000`,
    });
    const deadline = setTimeout(() => {
      forceCloseDatabaseClient(client);
    }, DATABASE_OPERATION_TIMEOUT_MS);
    try {
      await client.connect();
      return await work(client);
    } catch (error) {
      if (!isRetryable(error) || attempt === MAX_DATABASE_ATTEMPTS) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, attempt * 100));
    } finally {
      clearTimeout(deadline);
      await closeBoundedDatabaseClient(client);
    }
  }
  throw new Error("bounded E2E database fixture exhausted without returning or throwing");
}
