import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("E2E canonical-content isolation", () => {
  it("bounds reset locks and recovers only abandoned transactions in the isolated database", () => {
    const reset = read("tests/e2e/reset-content.ts");

    expect(reset).toContain('application_name: "myownnotion-e2e-content-reset"');
    expect(reset).toContain('application_name: "myownnotion-e2e-content-reset-recovery"');
    expect(reset).toContain("connectionTimeoutMillis: RESET_QUERY_TIMEOUT_MS");
    expect(reset).toContain("query_timeout: RESET_QUERY_TIMEOUT_MS");
    expect(reset).toContain("state LIKE 'idle in transaction%'");
    expect(reset).toContain("xact_start < clock_timestamp() - interval '30 seconds'");
    expect(reset).toContain("datname = current_database()");
    expect(reset).toContain("pid <> pg_backend_pid()");
    expect(reset).toContain("SET LOCAL lock_timeout = '2s'");
    expect(reset).toContain("SET LOCAL statement_timeout = '10s'");
    expect(reset).toContain('"55P03"');
    expect(reset).toContain('"57014"');
    expect(
      reset.indexOf("if (!retryable || attempt === MAX_RESET_ATTEMPTS) throw error;"),
    ).toBeLessThan(
      reset.indexOf("if (BLOCKED_RESET_CODES.has(code)) await recoverAbandonedTransactions();"),
    );
  });

  it("terminates complete child stacks before cleaning an interrupted matrix", () => {
    const matrix = read("scripts/e2e/run-local-matrix.ts");

    expect(matrix).toContain("const activeChildren = new Set<ChildProcess>()");
    expect(matrix).toContain('process.once("SIGINT", rememberInterruption)');
    expect(matrix).toContain('process.once("SIGTERM", rememberInterruption)');
    expect(matrix).toContain("process.kill(-child.pid, signal)");
    expect(matrix).toContain('detached: process.platform !== "win32"');
    expect(matrix).toContain('interruptedSignal === "SIGINT" ? 130 : 143');
    expect(matrix).toContain("Skipped $" + "{stack.project} after $" + "{interruptedSignal}");
  });

  it("resets and seeds before Playwright creates the browser context", () => {
    const fixtures = read("tests/e2e/fixtures.ts");

    expect(fixtures).toContain("async ({ baseURL }, use) =>");
    expect(fixtures).not.toContain("async ({ context, baseURL }, use) =>");
    expect(fixtures).toContain("storageState: async ({ freshContent }, use) =>");
    expect(fixtures).toContain("await use(freshContent)");
  });
});
