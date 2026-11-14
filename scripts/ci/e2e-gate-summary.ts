/**
 * Verdict, coverage guard and timings of the browser gate (feature 058).
 *
 * A lane job that ends green says that Playwright exited zero in that job. It
 * says nothing about how many journeys ran: the WebKit jobs once executed a
 * third of the corpus and nobody could tell from the checks. This script reads
 * the impact plan (what should have run) and the merged Playwright results
 * (what did run) and fails unless every selected journey file was reported by
 * its lane, every declared test was actually attempted or explicitly skipped,
 * and nothing failed or only passed on a second attempt.
 *
 * It also writes the measured duration of every journey file. A trusted run
 * stores that file, and the next impact plan sizes its lanes from it — so lane
 * balance follows the corpus without anyone maintaining a number.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { E2eLane, E2eTimings } from "./e2e-lanes.ts";

interface PlanView {
  event: string;
  headSha: string;
  e2e: { mode: "none" | "selected" | "full"; testFiles: string[]; lanes: E2eLane[] };
}

/** The parts of Playwright's JSON report this script relies on. */
interface ReportResult {
  status: string;
  duration: number;
}
interface ReportTest {
  projectName: string;
  status: "expected" | "unexpected" | "flaky" | "skipped";
  results: ReportResult[];
}
interface ReportSpec {
  title: string;
  file: string;
  tests: ReportTest[];
}
interface ReportSuite {
  file?: string;
  specs?: ReportSpec[];
  suites?: ReportSuite[];
}
export interface PlaywrightReport {
  suites: ReportSuite[];
}

export interface ProjectSummary {
  project: string;
  selectedFiles: number;
  tests: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  notRun: number;
  failedAttemptSeconds: number;
}

export interface LaneSummary {
  laneId: string;
  project: string;
  present: boolean;
  estimatedSeconds: number;
  durationSeconds: number;
}

export interface GateSummary {
  candidateSha: string;
  event: string;
  mode: PlanView["e2e"]["mode"];
  projects: ProjectSummary[];
  lanes: LaneSummary[];
  slowest: Array<{ project: string; file: string; title: string; seconds: number }>;
  verdict: "pass" | "fail";
  reasons: string[];
}

interface FlatTest {
  project: string;
  file: string;
  title: string;
  status: ReportTest["status"];
  results: ReportResult[];
}

const journeyKey = (file: string): string => path.posix.basename(file.replaceAll("\\", "/"));

function flatten(report: PlaywrightReport): FlatTest[] {
  const tests: FlatTest[] = [];
  const visit = (suite: ReportSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        tests.push({
          project: test.projectName,
          file: journeyKey(spec.file),
          title: spec.title,
          status: test.status,
          results: test.results,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  return tests;
}

const seconds = (results: readonly ReportResult[]): number =>
  results.reduce((sum, { duration }) => sum + duration, 0) / 1000;

export function summarizeGate(
  plan: PlanView,
  report: PlaywrightReport | null,
  presentLaneIds: ReadonlySet<string>,
): { summary: GateSummary; timings: E2eTimings } {
  const reasons: string[] = [];
  const timings: E2eTimings = { version: 1, projects: {} };
  const base = { candidateSha: plan.headSha, event: plan.event, mode: plan.e2e.mode };

  if (plan.e2e.lanes.length === 0) {
    return {
      summary: { ...base, projects: [], lanes: [], slowest: [], verdict: "pass", reasons },
      timings,
    };
  }
  if (report === null) reasons.push("The merged Playwright report is missing");

  const tests = report === null ? [] : flatten(report);
  const byProjectFile = new Map<string, FlatTest[]>();
  for (const test of tests) {
    const key = `${test.project}\u0000${test.file}`;
    byProjectFile.set(key, [...(byProjectFile.get(key) ?? []), test]);
  }

  const projectNames = [...new Set(plan.e2e.lanes.map(({ project }) => project))];
  const projects: ProjectSummary[] = [];
  const lanes: LaneSummary[] = [];

  for (const project of projectNames) {
    const summary: ProjectSummary = {
      project,
      selectedFiles: 0,
      tests: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      notRun: 0,
      failedAttemptSeconds: 0,
    };
    const assigned = new Set<string>();
    for (const lane of plan.e2e.lanes.filter((candidate) => candidate.project === project)) {
      const present = presentLaneIds.has(lane.id);
      if (!present) reasons.push(`Lane ${lane.id} produced no report`);
      let laneSeconds = 0;
      for (const file of lane.testFiles) {
        if (assigned.has(file)) reasons.push(`${file} is assigned to two ${project} lanes`);
        assigned.add(file);
        summary.selectedFiles += 1;
        const reported = byProjectFile.get(`${project}\u0000${journeyKey(file)}`) ?? [];
        if (reported.length === 0) {
          // A missing lane already explains every one of its files.
          if (present) reasons.push(`${project} reported no test for ${file}`);
          continue;
        }
        let fileSeconds = 0;
        let fileSettled = true;
        for (const test of reported) {
          summary.tests += 1;
          fileSeconds += seconds(test.results);
          if (test.results.length === 0) {
            summary.notRun += 1;
            fileSettled = false;
          } else if (test.status === "expected") {
            summary.passed += 1;
          } else if (test.status === "skipped") {
            summary.skipped += 1;
          } else {
            if (test.status === "flaky") summary.flaky += 1;
            else summary.failed += 1;
            fileSettled = false;
            summary.failedAttemptSeconds += seconds(
              test.results.filter(({ status }) => status !== "passed"),
            );
          }
        }
        laneSeconds += fileSeconds;
        // Only a file whose every test settled describes its real duration.
        if (fileSettled && fileSeconds > 0) {
          const measured = timings.projects[project] ?? {};
          measured[file] = Math.round(fileSeconds * 10) / 10;
          timings.projects[project] = measured;
        }
      }
      lanes.push({
        laneId: lane.id,
        project,
        present,
        estimatedSeconds: lane.estimatedSeconds,
        durationSeconds: Math.round(laneSeconds),
      });
    }
    const missing = plan.e2e.testFiles.filter((file) => !assigned.has(file));
    if (missing.length > 0) {
      reasons.push(`${project} lanes omit ${missing.length} selected journey file(s)`);
    }
    if (summary.failed > 0) reasons.push(`${project}: ${summary.failed} journey(s) failed`);
    if (summary.flaky > 0) {
      reasons.push(`${project}: ${summary.flaky} journey(s) only passed on a later attempt`);
    }
    if (summary.notRun > 0) reasons.push(`${project}: ${summary.notRun} journey(s) did not run`);
    summary.failedAttemptSeconds = Math.round(summary.failedAttemptSeconds);
    projects.push(summary);
  }

  const slowest = tests
    .map((test) => ({
      project: test.project,
      file: test.file,
      title: test.title,
      seconds: Math.round(seconds(test.results) * 10) / 10,
    }))
    .sort((left, right) => right.seconds - left.seconds || left.title.localeCompare(right.title))
    .slice(0, 10);

  return {
    summary: {
      ...base,
      projects,
      lanes,
      slowest,
      verdict: reasons.length === 0 ? "pass" : "fail",
      reasons,
    },
    timings,
  };
}

const minutes = (value: number): string => `${(value / 60).toFixed(1)} min`;

export function renderGateSummary(summary: GateSummary): string {
  if (summary.mode === "none") {
    return "## Browser gate\n\nNo journey was selected for this change.\n";
  }
  return [
    `## Browser gate: ${summary.verdict === "pass" ? "pass" : "FAIL"}`,
    "",
    ...(summary.reasons.length === 0
      ? []
      : [...summary.reasons.map((reason) => `- ${reason}`), ""]),
    "| Project | Files | Tests | Passed | Failed | Flaky | Skipped | Not run | Failed attempts |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.projects.map(
      (project) =>
        `| ${project.project} | ${project.selectedFiles} | ${project.tests} | ${project.passed} | ${project.failed} | ${project.flaky} | ${project.skipped} | ${project.notRun} | ${minutes(project.failedAttemptSeconds)} |`,
    ),
    "",
    "### Lanes",
    "",
    "| Lane | Report | Estimated | Measured journeys |",
    "| --- | --- | ---: | ---: |",
    ...summary.lanes.map(
      (lane) =>
        `| ${lane.laneId} | ${lane.present ? "present" : "**missing**"} | ${minutes(lane.estimatedSeconds)} | ${minutes(lane.durationSeconds)} |`,
    ),
    "",
    "### Slowest journeys",
    "",
    ...summary.slowest.map(
      (test) => `- ${test.seconds} s — ${test.project} › ${test.file} › ${test.title}`,
    ),
    "",
  ].join("\n");
}

function option(argv: readonly string[], name: string, fallback: string): string {
  const position = argv.indexOf(`--${name}`);
  return position === -1 ? fallback : (argv[position + 1] ?? fallback);
}

export function main(argv = process.argv.slice(2)): void {
  const plan = JSON.parse(
    readFileSync(option(argv, "plan", "test-impact.json"), "utf8"),
  ) as PlanView;
  const resultsPath = option(argv, "results", "e2e-results.json");
  const report = existsSync(resultsPath)
    ? (JSON.parse(readFileSync(resultsPath, "utf8")) as PlaywrightReport)
    : null;
  const blobDirectory = option(argv, "blobs", "all-blob-reports");
  const present = new Set(
    plan.e2e.lanes
      .filter(({ id }) => existsSync(path.join(blobDirectory, `report-${id}.zip`)))
      .map(({ id }) => id),
  );
  const { summary, timings } = summarizeGate(plan, report, present);
  writeFileSync(
    option(argv, "output", "e2e-gate-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  writeFileSync(
    option(argv, "timings-output", "e2e-timings.json"),
    `${JSON.stringify(timings, null, 2)}\n`,
  );
  const rendered = renderGateSummary(summary);
  const githubSummary = process.env["GITHUB_STEP_SUMMARY"];
  if (githubSummary !== undefined) appendFileSync(githubSummary, rendered, "utf8");
  console.info(rendered);
  if (summary.verdict === "fail") process.exit(1);
}

const entryPoint =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (entryPoint === import.meta.url) main();
