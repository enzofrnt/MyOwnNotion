/**
 * Timing rules of the browser gate (feature 058).
 *
 * `test.slow()` multiplies the *project* budget, so the same marker meant 180
 * seconds on Chromium and 360 on WebKit, and a broken journey waited that long
 * before saying so. Journeys that need more than the default state an explicit
 * budget instead, which is the same number on every engine and is reviewable.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  type PlaywrightReport,
  renderGateSummary,
  summarizeGate,
} from "../../scripts/ci/e2e-gate-summary.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const journeyRoot = path.join(repoRoot, "tests", "e2e");

function journeySources(): Array<{ file: string; source: string }> {
  return readdirSync(journeyRoot)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, source: readFileSync(path.join(journeyRoot, file), "utf8") }));
}

describe("browser gate timing rules", () => {
  it("never scales a journey budget with test.slow()", () => {
    const offenders = journeySources()
      .filter(({ source }) => /\btest\.slow\s*\(/u.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps every explicit journey budget within three minutes", () => {
    const offenders: string[] = [];
    for (const { file, source } of journeySources()) {
      for (const match of source.matchAll(/\btest\.setTimeout\(\s*([\d_]+)\s*\)/gu)) {
        const budget = Number((match[1] ?? "").replaceAll("_", ""));
        if (!Number.isFinite(budget) || budget > 180_000) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The coverage guard. Each case is a way the gate used to be able to look
 * green, or short, while journeys had not run.
 */
describe("browser gate verdict", () => {
  const fileA = "tests/e2e/a.spec.ts";
  const fileB = "tests/e2e/b.spec.ts";
  const plan = {
    event: "pull_request",
    headSha: "head",
    e2e: {
      mode: "selected" as const,
      testFiles: [fileA, fileB],
      lanes: [
        lane("chromium-desktop-1-2", "chromium-desktop", 1, 2, [fileA]),
        lane("chromium-desktop-2-2", "chromium-desktop", 2, 2, [fileB]),
      ],
    },
  };
  const everyLane = new Set(plan.e2e.lanes.map(({ id }) => id));

  function lane(id: string, project: string, index: number, total: number, testFiles: string[]) {
    return { id, project, index, total, testFiles, estimatedSeconds: 60 };
  }

  type Outcome = "expected" | "unexpected" | "flaky" | "skipped";
  function spec(file: string, title: string, status: Outcome, attempts: string[], ms = 2_000) {
    return {
      title,
      // Playwright reports the path relative to its test directory.
      file: file.replace("tests/e2e/", ""),
      tests: [
        {
          projectName: "chromium-desktop",
          status,
          results: attempts.map((attempt) => ({ status: attempt, duration: ms })),
        },
      ],
    };
  }
  const report = (...specs: ReturnType<typeof spec>[]): PlaywrightReport => ({
    suites: [{ suites: [{ specs }] }],
  });

  it("passes when every selected journey ran and passed, and records its duration", () => {
    const { summary, timings } = summarizeGate(
      plan,
      report(
        spec(fileA, "one", "expected", ["passed"]),
        spec(fileA, "two", "skipped", ["skipped"], 0),
        spec(fileB, "three", "expected", ["passed"], 4_000),
      ),
      everyLane,
    );
    expect(summary.verdict).toBe("pass");
    expect(summary.projects[0]).toMatchObject({ tests: 3, passed: 2, skipped: 1, notRun: 0 });
    expect(timings.projects["chromium-desktop"]).toEqual({ [fileA]: 2, [fileB]: 4 });
    expect(renderGateSummary(summary)).toContain("Browser gate: pass");
    const schema = JSON.parse(
      readFileSync(
        path.join(repoRoot, "specs/058-e2e-gate-throughput/contracts/e2e-gate-summary.schema.json"),
        "utf8",
      ),
    ) as object;
    expect(new Ajv2020({ strict: true }).compile(schema)(summary)).toBe(true);
  });

  it("fails when a lane produced no report, even if the others passed", () => {
    const { summary } = summarizeGate(
      plan,
      report(spec(fileA, "one", "expected", ["passed"])),
      new Set(["chromium-desktop-1-2"]),
    );
    expect(summary.verdict).toBe("fail");
    expect(summary.reasons).toContain("Lane chromium-desktop-2-2 produced no report");
  });

  it("fails when a lane reported, but not for one of its journey files", () => {
    const { summary } = summarizeGate(
      plan,
      report(spec(fileA, "one", "expected", ["passed"])),
      everyLane,
    );
    expect(summary.reasons).toContain(`chromium-desktop reported no test for ${fileB}`);
  });

  it("fails when a journey was declared but never attempted", () => {
    // What a lane interrupted by its failure cap leaves behind.
    const { summary, timings } = summarizeGate(
      plan,
      report(spec(fileA, "one", "expected", ["passed"]), spec(fileB, "two", "skipped", [])),
      everyLane,
    );
    expect(summary.verdict).toBe("fail");
    expect(summary.projects[0]?.notRun).toBe(1);
    // An unsettled file must not teach the planner a wrong duration.
    expect(timings.projects["chromium-desktop"]).toEqual({ [fileA]: 2 });
  });

  it("fails on a failed journey and on one that only passed on a later attempt", () => {
    const { summary } = summarizeGate(
      plan,
      report(
        spec(fileA, "one", "unexpected", ["failed"], 15_000),
        spec(fileB, "two", "flaky", ["failed", "passed"], 3_000),
      ),
      everyLane,
    );
    expect(summary.verdict).toBe("fail");
    expect(summary.projects[0]).toMatchObject({ failed: 1, flaky: 1, failedAttemptSeconds: 18 });
    expect(summary.slowest[0]).toMatchObject({ title: "one", seconds: 15 });
  });

  it("fails when the merged report itself is missing", () => {
    const { summary } = summarizeGate(plan, null, everyLane);
    expect(summary.reasons).toContain("The merged Playwright report is missing");
  });

  it("fails when the plan's lanes do not cover the selection", () => {
    const partial = { ...plan, e2e: { ...plan.e2e, lanes: plan.e2e.lanes.slice(0, 1) } };
    const { summary } = summarizeGate(
      partial,
      report(spec(fileA, "one", "expected", ["passed"])),
      everyLane,
    );
    expect(summary.reasons).toContain("chromium-desktop lanes omit 1 selected journey file(s)");
  });

  it("passes as an explicit no-op when no journey was selected", () => {
    const none = { ...plan, e2e: { mode: "none" as const, testFiles: [], lanes: [] } };
    const { summary } = summarizeGate(none, null, new Set());
    expect(summary).toMatchObject({ verdict: "pass", mode: "none", lanes: [] });
    expect(renderGateSummary(summary)).toContain("No journey was selected");
  });
});
