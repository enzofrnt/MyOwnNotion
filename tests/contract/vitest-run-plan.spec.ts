import { describe, expect, it } from "vitest";
import { planVitestInvocations, usesVitestProject } from "../../scripts/ci/vitest-run-plan.js";

const performanceTests = [
  "tests/performance/page-operations.perf.spec.ts",
  "tests/performance/search.perf.spec.ts",
];

describe("Vitest invocation planning", () => {
  it("recognizes both supported project argument forms", () => {
    expect(usesVitestProject(["run", "--project", "performance"], "performance")).toBe(true);
    expect(usesVitestProject(["run", "--project=performance"], "performance")).toBe(true);
    expect(usesVitestProject(["run", "--project", "contracts"], "performance")).toBe(false);
  });

  it("keeps ordinary projects in one invocation", () => {
    const arguments_ = ["run", "--project", "api-contract"];
    expect(planVitestInvocations(arguments_, performanceTests)).toEqual([arguments_]);
  });

  it("runs every full-suite performance benchmark in a fresh invocation", () => {
    expect(
      planVitestInvocations(
        ["run", "--project", "performance", "--maxWorkers=1"],
        [...performanceTests].reverse(),
      ),
    ).toEqual([
      [
        "run",
        "--project",
        "performance",
        "--maxWorkers=1",
        "tests/performance/page-operations.perf.spec.ts",
      ],
      [
        "run",
        "--project",
        "performance",
        "--maxWorkers=1",
        "tests/performance/search.perf.spec.ts",
      ],
    ]);
  });

  it("splits only explicitly selected performance benchmarks", () => {
    expect(
      planVitestInvocations(
        [
          "run",
          "--project=performance",
          "tests/performance/search.perf.spec.ts",
          "tests/performance/page-operations.perf.spec.ts",
          "--passWithNoTests",
        ],
        ["tests/performance/backup-restore.perf.spec.ts"],
      ),
    ).toHaveLength(2);
  });

  it("does not rewrite Vitest related mode", () => {
    const arguments_ = [
      "related",
      "--run",
      "--project",
      "performance",
      "packages/domain/src/document/block.ts",
    ];
    expect(planVitestInvocations(arguments_, performanceTests)).toEqual([arguments_]);
  });

  it("fails closed when a full performance run has no benchmark", () => {
    expect(() => planVitestInvocations(["run", "--project", "performance"], [])).toThrow(
      "No performance benchmark",
    );
  });
});
