/**
 * Tests wait for states, not for time (feature 060, docs/testing/wait-contracts.md).
 *
 * A sleep in a test is a guess that the operation the next step depends on has
 * finished. It passes on a fast runner and fails, or worse passes for the wrong
 * reason, on a slow one. This contract keeps two shapes out of every test file
 * in the repository:
 *
 * - Playwright's `waitForTimeout`;
 * - an awaited timer sleep, `new Promise((resolve) => setTimeout(resolve, n))`
 *   with a non-zero delay.
 *
 * It cannot see every disguised wait — a review still has to ask what each wait
 * proves — but it stops the two shapes that have repeatedly hidden races here.
 * The few legitimate timer uses are declared below with the reason they are not
 * synchronization. Adding one requires the same justification in review.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const TEST_ROOTS = [
  "tests/e2e",
  "tests/contract",
  "tests/performance",
  "apps/api/tests",
  "apps/web/tests",
  "apps/desktop/tests",
  ...readdirSync(path.join(repoRoot, "packages")).map((name) => `packages/${name}/tests`),
];

/**
 * Timer uses that are not a wait for an operation. Keyed by file and by the
 * delay expression, so moving the line does not invalidate the declaration but
 * changing what it waits for does.
 */
const DECLARED_TIMERS: ReadonlyArray<{
  readonly file: string;
  readonly delay: string;
  readonly reason: string;
}> = [
  {
    file: "tests/e2e/bounded-database.ts",
    delay: "attempt * 100",
    reason: "backoff between bounded reconnection attempts of a fixture database client",
  },
  {
    file: "tests/e2e/reset-installation.ts",
    delay: "attempt * 100",
    reason: "backoff between bounded attempts of the installation reset fixture",
  },
  {
    file: "tests/e2e/reset-installation.ts",
    delay: "attempt * 50",
    reason: "backoff between bounded attempts of the session seeding fixture",
  },
  {
    file: "tests/e2e/reset-content.ts",
    delay: "attempt * 50",
    reason: "backoff between bounded attempts of the content reset fixture",
  },
  {
    file: "tests/e2e/desktop-process.ts",
    delay: "(attempt + 1) * 100",
    reason: "backoff while a spawned desktop process opens its debugging port",
  },
  {
    file: "tests/e2e/progressive-startup.spec.ts",
    delay: "remaining",
    reason: "the journey deliberately holds a server response: the delay is its input",
  },
  {
    file: "tests/e2e/editor-performance.spec.ts",
    delay: "settleMs",
    reason: "paces keystrokes of a latency measurement; the measurement is the subject",
  },
  {
    file: "apps/api/tests/production-startup.spec.ts",
    delay: "10",
    reason: "interval of a bounded poll of pg_locks that fails with an explicit message",
  },
  {
    file: "apps/api/tests/realtime-page-sync.contract.spec.ts",
    delay: "20",
    reason:
      "known limit: negative broadcast check without a positive anchor; see docs/testing/wait-contracts.md",
  },
];

function testFiles(): string[] {
  const files: string[] = [];
  const visit = (relative: string) => {
    const absolute = path.join(repoRoot, relative);
    let entries: string[];
    try {
      entries = readdirSync(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules") continue;
      const child = path.join(relative, entry);
      if (statSync(path.join(repoRoot, child)).isDirectory()) visit(child);
      else if (/\.(?:ts|tsx)$/u.test(entry)) files.push(child);
    }
  };
  for (const root of TEST_ROOTS) visit(root);
  return files;
}

const SELF = "tests/contract/test-wait-contracts.spec.ts";
const SLEEP =
  /new Promise[^;\n]{0,80}?setTimeout\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:[^()\n]|\([^()\n]*\))+?)\s*\)/gu;

describe("test synchronization contract", () => {
  it("scans the test roots it claims to scan", () => {
    const files = testFiles();
    expect(files.some((file) => file.startsWith("tests/e2e/"))).toBe(true);
    expect(files.some((file) => file.startsWith("apps/web/tests/"))).toBe(true);
    expect(files.some((file) => file.startsWith("apps/api/tests/"))).toBe(true);
    expect(files.some((file) => file.startsWith("packages/"))).toBe(true);
  });

  it("never waits with Playwright's waitForTimeout", () => {
    const offenders = testFiles()
      .filter((file) => file !== SELF)
      .filter((file) =>
        /\bwaitForTimeout\s*\(/u.test(readFileSync(path.join(repoRoot, file), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  it("never sleeps for a guessed duration outside a declared timer", () => {
    const offenders: string[] = [];
    const used = new Set<(typeof DECLARED_TIMERS)[number]>();
    for (const file of testFiles()) {
      if (file === SELF) continue;
      const source = readFileSync(path.join(repoRoot, file), "utf8");
      for (const match of source.matchAll(SLEEP)) {
        const delay = (match[1] ?? "").trim();
        if (delay === "0") continue;
        const declared = DECLARED_TIMERS.find(
          (entry) => entry.file === file && entry.delay === delay,
        );
        if (declared === undefined) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${file}:${line} sleeps for ${delay}`);
        } else {
          used.add(declared);
        }
      }
    }
    expect(offenders).toEqual([]);
    // A declaration whose timer is gone must go too, or it would excuse the
    // next sleep added to that file.
    expect(DECLARED_TIMERS.filter((entry) => !used.has(entry))).toEqual([]);
  });

  it("detects the shapes it forbids", () => {
    const sample = [
      "await new Promise((resolve) => setTimeout(resolve, 400));",
      "await new Promise<void>((r) => setTimeout(r, attempt * 50));",
      "await new Promise<void>((resolve) => setTimeout(resolve, (attempt + 1) * 100));",
    ].join("\n");
    expect([...sample.matchAll(SLEEP)].map((match) => match[1])).toEqual([
      "400",
      "attempt * 50",
      "(attempt + 1) * 100",
    ]);
  });
});
