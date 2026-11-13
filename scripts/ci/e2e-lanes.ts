/**
 * Self-sizing browser lanes (feature 058).
 *
 * Every Playwright journey resets one shared database, so a browser project
 * cannot run its journeys on several workers of one stack. A CI job, however,
 * already owns a complete stack — its own PostgreSQL, API, preview server and
 * browser — so several jobs per project are safe. This module decides how many
 * jobs ("lanes") each project gets and which journey files each lane runs.
 *
 * Nothing here is a hand-maintained count. The number of lanes follows the
 * estimated duration of the selected journeys:
 *
 *   lanes = clamp(ceil(estimate / targetSeconds), 1, min(maxPerProject, files))
 *
 * and, when the projects together ask for more lanes than the runner pool can
 * start at once (`maxTotal`), lanes are taken back one at a time from the
 * project that stays shortest without it. Longer lanes that all start
 * together beat short lanes waiting in a queue.
 *
 * and the estimate comes from the measured duration of each file in the last
 * trusted run when that is available, otherwise from the number of tests the
 * file declares. Adding journeys therefore adds lanes with no edit to any
 * policy. Files are assigned by longest-processing-time bin packing, which is
 * deterministic: the same selection and the same timings always give the same
 * lanes, so a plan can be reproduced from its recorded inputs.
 */

export interface E2eLanePolicy {
  /** Desired journey time of one lane, in seconds. */
  targetSeconds: number;
  /** Safety cap: an estimate bug must not request dozens of runners. */
  maxPerProject: number;
  /**
   * Lanes the whole matrix may use at once. Runners are a shared, limited
   * pool: lanes beyond it do not run in parallel, they queue, and a queued
   * short lane finishes later than a longer one that started immediately.
   */
  maxTotal: number;
  /** Weight of one declared test when no measurement exists for its file. */
  defaultSecondsPerTest: number;
}

/** Measured seconds per journey file, per browser project. */
export interface E2eTimings {
  version: 1;
  projects: Record<string, Record<string, number>>;
}

export interface E2eLane {
  id: string;
  project: string;
  index: number;
  total: number;
  testFiles: string[];
  estimatedSeconds: number;
}

export interface E2eMatrixEntry {
  project: string;
  lane: string;
  laneId: string;
}

export interface E2eLaneInputs {
  /** Declared test count per journey file; a missing file uses the fallback. */
  testCounts?: Readonly<Record<string, number>>;
  timings?: E2eTimings | null;
}

/** Used when a journey file's declared test count is unknown. */
export const FALLBACK_TESTS_PER_FILE = 6;

export const NO_E2E_MATRIX: E2eMatrixEntry[] = [{ project: "none", lane: "1/1", laneId: "none" }];

/**
 * Counts the tests a journey file declares, without loading Playwright.
 *
 * This is an estimate, and only a fallback: it sees `test("…")`,
 * `test.only`, `test.fixme` and `test.fail` declarations and cannot see a loop
 * that declares several. It is replaced by a measured duration as soon as one
 * trusted run has reported the file.
 */
export function countDeclaredTests(source: string): number {
  const declarations = source.match(/(?:^|[^.\w])test(?:\.(?:only|fixme|fail))?\(\s*[`'"]/gmu);
  return Math.max(1, declarations?.length ?? 0);
}

export function validateLanePolicy(policy: E2eLanePolicy | undefined): string[] {
  if (policy === undefined) return ["e2eLanes is required"];
  const failures: string[] = [];
  const { targetSeconds, maxPerProject, maxTotal, defaultSecondsPerTest } = policy;
  if (!Number.isInteger(targetSeconds) || targetSeconds < 120 || targetSeconds > 3600) {
    failures.push("e2eLanes.targetSeconds must be an integer between 120 and 3600");
  }
  if (!Number.isInteger(maxPerProject) || maxPerProject < 1 || maxPerProject > 12) {
    failures.push("e2eLanes.maxPerProject must be an integer between 1 and 12");
  }
  if (!Number.isInteger(maxTotal) || maxTotal < 1 || maxTotal > 60) {
    failures.push("e2eLanes.maxTotal must be an integer between 1 and 60");
  }
  if (
    typeof defaultSecondsPerTest !== "number" ||
    !Number.isFinite(defaultSecondsPerTest) ||
    defaultSecondsPerTest <= 0
  ) {
    failures.push("e2eLanes.defaultSecondsPerTest must be a positive number");
  }
  return failures;
}

/** Accepts only a well-formed timings document; anything else means "no data". */
export function parseTimings(raw: unknown): E2eTimings | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as { version?: unknown; projects?: unknown };
  if (candidate.version !== 1) return null;
  if (typeof candidate.projects !== "object" || candidate.projects === null) return null;
  const projects: Record<string, Record<string, number>> = {};
  for (const [project, files] of Object.entries(candidate.projects)) {
    if (typeof files !== "object" || files === null) continue;
    const measured: Record<string, number> = {};
    for (const [file, seconds] of Object.entries(files)) {
      if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
        measured[file] = seconds;
      }
    }
    projects[project] = measured;
  }
  return { version: 1, projects };
}

function fileWeight(
  policy: E2eLanePolicy,
  project: string,
  file: string,
  inputs: E2eLaneInputs,
): number {
  const measured = inputs.timings?.projects[project]?.[file];
  if (measured !== undefined) return measured;
  const declared = inputs.testCounts?.[file] ?? FALLBACK_TESTS_PER_FILE;
  return declared * policy.defaultSecondsPerTest;
}

interface WeightedFile {
  file: string;
  weight: number;
}

function weighFiles(
  policy: E2eLanePolicy,
  project: string,
  testFiles: readonly string[],
  inputs: E2eLaneInputs,
): WeightedFile[] {
  return (
    testFiles
      .map((file) => ({ file, weight: fileWeight(policy, project, file, inputs) }))
      // Heaviest first; the path breaks ties so the order never depends on input order.
      .sort((left, right) => right.weight - left.weight || left.file.localeCompare(right.file))
  );
}

/**
 * Lane count of each project: what its own duration asks for, then reduced
 * until the whole matrix fits the runner pool. Every project keeps one lane.
 */
function laneCounts(policy: E2eLanePolicy, estimates: readonly number[], files: number): number[] {
  const counts = estimates.map((estimate) =>
    Math.max(1, Math.min(policy.maxPerProject, files, Math.ceil(estimate / policy.targetSeconds))),
  );
  let total = counts.reduce((sum, count) => sum + count, 0);
  while (total > policy.maxTotal) {
    // Take a lane from the project whose lanes stay shortest without it. The
    // first such project wins a tie, so the result never depends on timing.
    let candidate = -1;
    let shortest = Number.POSITIVE_INFINITY;
    for (const [position, count] of counts.entries()) {
      if (count <= 1) continue;
      const after = (estimates[position] ?? 0) / (count - 1);
      if (after < shortest) {
        shortest = after;
        candidate = position;
      }
    }
    if (candidate === -1) break;
    counts[candidate] = (counts[candidate] ?? 1) - 1;
    total -= 1;
  }
  return counts;
}

function packLanes(project: string, weighted: readonly WeightedFile[], total: number): E2eLane[] {
  const bins = Array.from({ length: total }, () => ({ files: [] as string[], seconds: 0 }));
  for (const { file, weight } of weighted) {
    let lightest = bins[0];
    for (const bin of bins) {
      if (lightest === undefined || bin.seconds < lightest.seconds) lightest = bin;
    }
    if (lightest === undefined) throw new Error("A browser project always has one lane");
    lightest.files.push(file);
    lightest.seconds += weight;
  }
  return bins.map((bin, position) => ({
    id: `${project}-${position + 1}-${total}`,
    project,
    index: position + 1,
    total,
    testFiles: [...bin.files].sort(),
    estimatedSeconds: Math.round(bin.seconds),
  }));
}

export function planE2eLanes(
  policy: E2eLanePolicy,
  projects: readonly string[],
  testFiles: readonly string[],
  inputs: E2eLaneInputs = {},
): { lanes: E2eLane[]; matrix: E2eMatrixEntry[] } {
  const selected = [...new Set(testFiles)].sort();
  if (selected.length === 0) return { lanes: [], matrix: NO_E2E_MATRIX };
  const weighted = projects.map((project) => weighFiles(policy, project, selected, inputs));
  const estimates = weighted.map((files) => files.reduce((sum, { weight }) => sum + weight, 0));
  const counts = laneCounts(policy, estimates, selected.length);
  const lanes = projects.flatMap((project, position) =>
    packLanes(project, weighted[position] ?? [], counts[position] ?? 1),
  );
  return {
    lanes,
    matrix: lanes.map(({ project, index, total, id }) => ({
      project,
      lane: `${index}/${total}`,
      laneId: id,
    })),
  };
}
