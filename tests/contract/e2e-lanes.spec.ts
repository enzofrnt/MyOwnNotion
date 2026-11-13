/**
 * Self-sizing browser lanes (feature 058).
 *
 * The properties here are what makes the lane model safe to leave alone: for
 * any selection the lanes of a project are a partition of it, the same inputs
 * always give the same lanes, and a growing corpus gets more lanes without any
 * edit to the policy.
 */
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  countDeclaredTests,
  type E2eLanePolicy,
  NO_E2E_MATRIX,
  parseTimings,
  planE2eLanes,
  validateLanePolicy,
} from "../../scripts/ci/e2e-lanes.js";
import {
  createImpactPlan,
  loadImpactPolicy,
  readLaneInputs,
} from "../../scripts/ci/test-impact.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const policy = loadImpactPolicy(repoRoot);
const sizing: E2eLanePolicy = { targetSeconds: 720, maxPerProject: 6, defaultSecondsPerTest: 7 };
const projects = ["chromium-desktop", "webkit-mobile"];

const journey = (index: number): string =>
  `tests/e2e/journey-${String(index).padStart(3, "0")}.spec.ts`;
const corpus = (size: number): string[] =>
  Array.from({ length: size }, (_, index) => journey(index));
const counts = (files: string[], perFile: number): Record<string, number> =>
  Object.fromEntries(files.map((file) => [file, perFile]));

describe("lane sizing policy", () => {
  it("is declared and valid in the repository policy", () => {
    expect(validateLanePolicy(policy.e2eLanes)).toEqual([]);
  });

  it.each([
    [{ ...sizing, targetSeconds: 60 }, "targetSeconds"],
    [{ ...sizing, maxPerProject: 0 }, "maxPerProject"],
    [{ ...sizing, maxPerProject: 40 }, "maxPerProject"],
    [{ ...sizing, defaultSecondsPerTest: 0 }, "defaultSecondsPerTest"],
  ])("rejects an out-of-range value %j", (invalid, field) => {
    expect(validateLanePolicy(invalid).join("\n")).toContain(field);
  });

  it("rejects a policy without the sizing block", () => {
    expect(validateLanePolicy(undefined)).toEqual(["e2eLanes is required"]);
  });
});

describe("lane planning", () => {
  it("partitions any selection of every project, deterministically", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 400 }), { minLength: 1, maxLength: 120 }),
        fc.integer({ min: 1, max: 30 }),
        (indexes, perFile) => {
          const files = indexes.map(journey);
          const inputs = { testCounts: counts(files, perFile) };
          const { lanes, matrix } = planE2eLanes(sizing, projects, files, inputs);
          for (const project of projects) {
            const own = lanes.filter((lane) => lane.project === project);
            const assigned = own.flatMap((lane) => lane.testFiles);
            expect([...assigned].sort()).toEqual([...files].sort());
            expect(new Set(assigned).size).toBe(assigned.length);
            expect(own.every((lane) => lane.testFiles.length > 0)).toBe(true);
            expect(own.length).toBeLessThanOrEqual(sizing.maxPerProject);
            expect(own.map((lane) => lane.index)).toEqual(own.map((_, index) => index + 1));
          }
          expect(matrix.map(({ laneId }) => laneId)).toEqual(lanes.map(({ id }) => id));
          // Input order is irrelevant: the plan depends on the selection only.
          expect(planE2eLanes(sizing, projects, [...files].reverse(), inputs).lanes).toEqual(lanes);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("gives a narrow selection exactly one lane per project", () => {
    const { lanes } = planE2eLanes(sizing, projects, [journey(1)], {
      testCounts: { [journey(1)]: 400 },
    });
    expect(lanes.map(({ id }) => id)).toEqual(["chromium-desktop-1-1", "webkit-mobile-1-1"]);
  });

  it("adds lanes as the corpus grows, with no policy edit, up to the cap", () => {
    const lanesFor = (size: number): number =>
      planE2eLanes(sizing, ["chromium-desktop"], corpus(size), {
        testCounts: counts(corpus(size), 5),
      }).lanes.length;
    // 5 tests × 7 s = 35 s per file against a 720-second lane.
    expect(lanesFor(20)).toBe(1);
    expect(lanesFor(60)).toBe(3);
    expect(lanesFor(120)).toBe(6);
    expect(lanesFor(1000)).toBe(sizing.maxPerProject);
  });

  it("prefers measured timings and balances lanes by duration", () => {
    const files = corpus(8);
    const seconds = [600, 300, 200, 100, 90, 60, 50, 40];
    const timings = parseTimings({
      version: 1,
      projects: {
        "chromium-desktop": Object.fromEntries(files.map((file, index) => [file, seconds[index]])),
      },
    });
    const { lanes } = planE2eLanes(sizing, ["chromium-desktop"], files, {
      testCounts: counts(files, 1),
      timings,
    });
    // 1,440 measured seconds → two lanes; the static estimate (8 tests × 7 s)
    // would have asked for one. Greedy packing lands within ten seconds of an
    // even split here.
    expect(lanes.map(({ estimatedSeconds }) => estimatedSeconds)).toEqual([730, 710]);
    expect(lanes[0]?.testFiles).toContain(files[0]);
  });

  it("falls back per file when a timing is missing or malformed", () => {
    expect(parseTimings(null)).toBeNull();
    expect(parseTimings({ version: 2, projects: {} })).toBeNull();
    const timings = parseTimings({
      version: 1,
      projects: {
        "chromium-desktop": { [journey(0)]: -5, [journey(1)]: "slow", [journey(2)]: 30 },
      },
    });
    expect(timings?.projects["chromium-desktop"]).toEqual({ [journey(2)]: 30 });
    const { lanes } = planE2eLanes(sizing, ["chromium-desktop"], corpus(3), {
      testCounts: counts(corpus(3), 2),
      timings,
    });
    expect(lanes[0]?.estimatedSeconds).toBe(14 + 14 + 30);
  });

  it("uses the explicit no-op sentinel for an empty selection", () => {
    expect(planE2eLanes(sizing, projects, [])).toEqual({ lanes: [], matrix: NO_E2E_MATRIX });
  });

  it("counts declared tests without counting describe blocks or other calls", () => {
    const source = [
      'test.describe("group", () => {',
      '  test("one", async () => {});',
      "  test.fixme(`two`, async () => {});",
      "  test.setTimeout(1);",
      '  await contest("no");',
      "});",
    ].join("\n");
    expect(countDeclaredTests(source)).toBe(2);
    expect(countDeclaredTests("// nothing declared")).toBe(1);
  });
});

describe("lanes in the impact plan", () => {
  it("covers the complete corpus once per project on a trusted run", () => {
    const plan = createImpactPlan(
      policy,
      {
        event: "push",
        ref: "refs/heads/main",
        baseSha: null,
        headSha: "head",
        pullRequestNumber: null,
        changedPaths: [],
        deletedPaths: [],
      },
      readLaneInputs(repoRoot, policy, null),
    );
    for (const project of policy.e2eProjects) {
      const assigned = plan.e2e.lanes
        .filter((lane) => lane.project === project)
        .flatMap((lane) => lane.testFiles);
      expect([...assigned].sort()).toEqual(plan.e2e.testFiles);
    }
    // The complete corpus is far larger than one lane; a single lane per
    // project would mean the sizing silently stopped working.
    expect(plan.e2e.matrix.length).toBeGreaterThan(policy.e2eProjects.length);
  });
});
