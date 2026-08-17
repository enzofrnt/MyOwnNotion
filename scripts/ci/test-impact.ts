import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export type VitestGroup = "unit" | "integration" | "contract";

export interface PathRules {
  exact: string[];
  prefixes: string[];
  suffixes: string[];
}

export interface ImpactPolicy {
  version: 1;
  nonExecutable: PathRules;
  vitestNoImpact: PathRules;
  e2eNoImpact: PathRules;
  fullVitest: PathRules;
  fullE2e: PathRules;
  vitestConsumers: Array<{
    paths: PathRules;
    tests: string[];
    groups: VitestGroup[];
  }>;
  e2eJourneys: Array<{ test: string; owners: PathRules }>;
  e2eIgnored: string[];
  e2eProjects: string[];
}

export interface ImpactInput {
  event: string;
  ref: string;
  baseSha: string | null;
  headSha: string;
  pullRequestNumber: string | null;
  changedPaths: string[];
  deletedPaths: string[];
}

export interface ImpactPlan {
  version: 1;
  event: string;
  baseSha: string | null;
  headSha: string;
  changedPaths: string[];
  deletedPaths: string[];
  mode: "none" | "affected" | "full";
  vitest: {
    mode: "none" | "related" | "direct" | "mixed" | "full";
    sourceFiles: string[];
    testFiles: string[];
    groups: VitestGroup[];
  };
  e2e: {
    mode: "none" | "selected" | "full";
    testFiles: string[];
    matrix: Array<{ project: string }>;
  };
  cacheScope: string;
  reasons: string[];
  unknownPaths: string[];
}

const ALL_VITEST_GROUPS: VitestGroup[] = ["unit", "integration", "contract"];
const TEST_FILE_PATTERN = /(?:^|\/)tests\/.+\.(?:spec|test)\.(?:ts|tsx)$/;
const E2E_FILE_PATTERN = /^tests\/e2e\/.+\.spec\.ts$/;
const MAINTAINED_SOURCE_PATTERN = /^(?:apps|packages)\/[^/]+\/src\/.+\.tsx?$/;
const TEST_SUPPORT_PATTERN = /^(?:apps|packages)\/[^/]+\/tests\/.+\.tsx?$/;

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function normalizeRepoPath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/").replace(/^\.\//, ""));
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new Error(`Path must be repository-relative: ${value}`);
  }
  return normalized;
}

function matchesRules(file: string, rules: PathRules): boolean {
  return (
    rules.exact.includes(file) ||
    rules.prefixes.some((prefix) => file.startsWith(prefix)) ||
    rules.suffixes.some((suffix) => file.endsWith(suffix))
  );
}

function groupsForPath(file: string): VitestGroup[] {
  if (file.startsWith("tests/contract/")) {
    return ["contract"];
  }
  if (file.startsWith("apps/api/")) {
    return ["contract"];
  }
  if (file.startsWith("packages/database/")) {
    return ["integration", "contract"];
  }
  if (file.startsWith("packages/domain/") || file.startsWith("packages/test-utils/")) {
    return ["unit", "integration", "contract"];
  }
  if (file.startsWith("packages/contracts/") || file.startsWith("packages/blob-store/")) {
    return ["unit", "contract"];
  }
  return ["unit"];
}

function cacheScopeFor(input: ImpactInput): string {
  if (input.event === "pull_request") {
    return `pr-${input.pullRequestNumber ?? input.headSha}`;
  }
  if (input.ref === "refs/heads/main") {
    return "main";
  }
  if (input.ref.startsWith("refs/tags/v")) {
    return `release-${input.headSha}`;
  }
  return `diagnostic-${input.headSha}`;
}

function fullPlan(policy: ImpactPolicy, input: ImpactInput, reasons: string[]): ImpactPlan {
  return {
    version: 1,
    event: input.event,
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedPaths: sortedUnique(input.changedPaths.map(normalizeRepoPath)),
    deletedPaths: sortedUnique(input.deletedPaths.map(normalizeRepoPath)),
    mode: "full",
    vitest: {
      mode: "full",
      sourceFiles: [],
      testFiles: [],
      groups: [...ALL_VITEST_GROUPS],
    },
    e2e: {
      mode: "full",
      testFiles: sortedUnique(policy.e2eJourneys.map(({ test }) => test)),
      matrix: policy.e2eProjects.map((project) => ({ project })),
    },
    cacheScope: cacheScopeFor(input),
    reasons: sortedUnique(reasons),
    unknownPaths: [],
  };
}

export function loadImpactPolicy(repoRoot: string): ImpactPolicy {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "ci", "test-impact.json"), "utf8"),
  ) as ImpactPolicy;
}

function validateRules(name: string, rules: PathRules, failures: string[]): void {
  for (const key of ["exact", "prefixes", "suffixes"] as const) {
    if (!Array.isArray(rules[key])) {
      failures.push(`${name}.${key} must be an array`);
      continue;
    }
    const values = rules[key];
    if (new Set(values).size !== values.length) {
      failures.push(`${name}.${key} contains duplicates`);
    }
    for (const value of values) {
      if (
        value.length === 0 ||
        value.includes("\\") ||
        (key !== "suffixes" && value.startsWith("/"))
      ) {
        failures.push(`${name}.${key} contains a non-normalized path: ${value}`);
      }
    }
  }
}

export function validateImpactPolicy(policy: ImpactPolicy, repoRoot: string): string[] {
  const failures: string[] = [];
  if (policy.version !== 1) {
    failures.push(`unsupported policy version: ${String(policy.version)}`);
  }

  for (const [name, rules] of [
    ["nonExecutable", policy.nonExecutable],
    ["vitestNoImpact", policy.vitestNoImpact],
    ["e2eNoImpact", policy.e2eNoImpact],
    ["fullVitest", policy.fullVitest],
    ["fullE2e", policy.fullE2e],
  ] as const) {
    validateRules(name, rules, failures);
  }

  for (const prefix of policy.nonExecutable.prefixes) {
    if (
      ["apps/", "packages/", "scripts/", "tests/", "docker/"].some((root) =>
        prefix.startsWith(root),
      )
    ) {
      failures.push(`nonExecutable prefix covers maintained executable input: ${prefix}`);
    }
  }
  for (const suffix of policy.nonExecutable.suffixes) {
    if (suffix !== ".md") {
      failures.push(`nonExecutable suffix is not an approved documentation type: ${suffix}`);
    }
  }

  const journeyTests = policy.e2eJourneys.map(({ test }) => test);
  if (new Set(journeyTests).size !== journeyTests.length) {
    failures.push("e2eJourneys contains duplicate journey files");
  }
  const actualJourneys = readdirSync(path.join(repoRoot, "tests", "e2e"))
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => `tests/e2e/${file}`)
    .sort();
  if (JSON.stringify([...journeyTests].sort()) !== JSON.stringify(actualJourneys)) {
    failures.push("e2eJourneys must declare every tests/e2e/*.spec.ts file exactly once");
  }
  for (const journey of policy.e2eJourneys) {
    validateRules(`e2eJourneys.${journey.test}.owners`, journey.owners, failures);
    if (!existsSync(path.join(repoRoot, journey.test))) {
      failures.push(`declared E2E journey does not exist: ${journey.test}`);
    }
    const ownerCount =
      journey.owners.exact.length + journey.owners.prefixes.length + journey.owners.suffixes.length;
    if (ownerCount === 0) {
      failures.push(`E2E journey has no owner: ${journey.test}`);
    }
  }

  for (const consumer of policy.vitestConsumers) {
    validateRules("vitestConsumers.paths", consumer.paths, failures);
    for (const testFile of consumer.tests) {
      if (!existsSync(path.join(repoRoot, testFile))) {
        failures.push(`declared Vitest consumer does not exist: ${testFile}`);
      }
    }
    for (const group of consumer.groups) {
      if (!ALL_VITEST_GROUPS.includes(group)) {
        failures.push(`unknown Vitest group: ${group}`);
      }
    }
  }

  for (const ignored of policy.e2eIgnored) {
    if (!existsSync(path.join(repoRoot, ignored))) {
      failures.push(`declared E2E support file does not exist: ${ignored}`);
    }
    if (!policy.fullE2e.exact.includes(ignored)) {
      failures.push(`declared E2E support file is not a full-suite trigger: ${ignored}`);
    }
  }
  if (
    new Set(policy.e2eProjects).size !== policy.e2eProjects.length ||
    policy.e2eProjects.length === 0 ||
    policy.e2eProjects.includes("none")
  ) {
    failures.push("e2eProjects must contain unique project names and reserve the none sentinel");
  }

  return sortedUnique(failures);
}

export function createImpactPlan(policy: ImpactPolicy, rawInput: ImpactInput): ImpactPlan {
  const input: ImpactInput = {
    ...rawInput,
    changedPaths: sortedUnique(rawInput.changedPaths.map(normalizeRepoPath)),
    deletedPaths: sortedUnique(rawInput.deletedPaths.map(normalizeRepoPath)),
  };
  if (input.deletedPaths.some((file) => !input.changedPaths.includes(file))) {
    throw new Error("Every deleted path must also appear in changedPaths");
  }

  if (input.event !== "pull_request") {
    return fullPlan(policy, input, [`${input.event} execution requires the complete test corpus`]);
  }
  if (input.baseSha === null || input.baseSha.length === 0) {
    return fullPlan(policy, input, ["Pull-request comparison base is unavailable"]);
  }

  const sourceFiles = new Set<string>();
  const testFiles = new Set<string>();
  const groups = new Set<VitestGroup>();
  const e2eTests = new Set<string>();
  const reasons = new Set<string>();
  const unknownPaths = new Set<string>();
  const deletedPaths = new Set(input.deletedPaths);
  let forceFullVitest = false;
  let forceFullE2e = false;

  for (const file of input.changedPaths) {
    let vitestClassified = false;
    let e2eClassified = false;

    if (matchesRules(file, policy.fullVitest)) {
      forceFullVitest = true;
      vitestClassified = true;
      reasons.add(`${file} is a broad Vitest input`);
    }
    if (matchesRules(file, policy.fullE2e)) {
      forceFullE2e = true;
      e2eClassified = true;
      reasons.add(`${file} is a broad E2E input`);
    }
    if (
      deletedPaths.has(file) &&
      (MAINTAINED_SOURCE_PATTERN.test(file) || TEST_SUPPORT_PATTERN.test(file))
    ) {
      forceFullVitest = true;
      vitestClassified = true;
      reasons.add(`${file} was deleted, so its former Vitest dependency graph is unavailable`);
    }

    for (const consumer of policy.vitestConsumers) {
      if (!matchesRules(file, consumer.paths)) {
        continue;
      }
      vitestClassified = true;
      for (const testFile of consumer.tests) {
        testFiles.add(testFile);
      }
      for (const group of consumer.groups) {
        groups.add(group);
      }
      reasons.add(`${file} has declared Vitest consumers`);
    }

    if (E2E_FILE_PATTERN.test(file)) {
      e2eTests.add(file);
      e2eClassified = true;
      vitestClassified = true;
      reasons.add(`${file} is a changed E2E journey`);
    } else if (TEST_FILE_PATTERN.test(file)) {
      testFiles.add(file);
      for (const group of groupsForPath(file)) {
        groups.add(group);
      }
      vitestClassified = true;
      e2eClassified = true;
      reasons.add(`${file} is a changed Vitest file`);
    }

    if (
      !TEST_FILE_PATTERN.test(file) &&
      (MAINTAINED_SOURCE_PATTERN.test(file) || TEST_SUPPORT_PATTERN.test(file))
    ) {
      sourceFiles.add(file);
      for (const group of groupsForPath(file)) {
        groups.add(group);
      }
      vitestClassified = true;
      reasons.add(`${file} uses Vitest dependency selection`);

      if (TEST_SUPPORT_PATTERN.test(file)) {
        e2eClassified = true;
      } else {
        for (const journey of policy.e2eJourneys) {
          if (matchesRules(file, journey.owners)) {
            e2eTests.add(journey.test);
            e2eClassified = true;
          }
        }
      }
    }

    if (matchesRules(file, policy.vitestNoImpact)) {
      vitestClassified = true;
    }
    if (matchesRules(file, policy.e2eNoImpact)) {
      e2eClassified = true;
    }
    if (matchesRules(file, policy.nonExecutable)) {
      vitestClassified = true;
      e2eClassified = true;
      reasons.add(`${file} is a maintained non-executable path with no remaining consumer`);
    }

    if (!vitestClassified) {
      forceFullVitest = true;
      unknownPaths.add(file);
      reasons.add(`${file} has no Vitest impact rule`);
    }
    if (!e2eClassified) {
      forceFullE2e = true;
      unknownPaths.add(file);
      reasons.add(`${file} has no E2E impact rule`);
    }
  }

  const selectedGroups = sortedUnique(groups) as VitestGroup[];
  const selectedSources = sortedUnique(sourceFiles);
  const selectedTests = sortedUnique(testFiles);
  const selectedE2e = forceFullE2e
    ? sortedUnique(policy.e2eJourneys.map(({ test }) => test))
    : sortedUnique(e2eTests);

  const vitestMode: ImpactPlan["vitest"]["mode"] = forceFullVitest
    ? "full"
    : selectedSources.length > 0 && selectedTests.length > 0
      ? "mixed"
      : selectedSources.length > 0
        ? "related"
        : selectedTests.length > 0
          ? "direct"
          : "none";
  const e2eMode: ImpactPlan["e2e"]["mode"] = forceFullE2e
    ? "full"
    : selectedE2e.length > 0
      ? "selected"
      : "none";
  const mode: ImpactPlan["mode"] =
    forceFullVitest || forceFullE2e
      ? "full"
      : vitestMode === "none" && e2eMode === "none"
        ? "none"
        : "affected";

  if (input.changedPaths.length === 0) {
    reasons.add("The pull request has no changed paths");
  }

  return {
    version: 1,
    event: input.event,
    baseSha: input.baseSha,
    headSha: input.headSha,
    changedPaths: input.changedPaths,
    deletedPaths: input.deletedPaths,
    mode,
    vitest: {
      mode: vitestMode,
      sourceFiles: forceFullVitest ? [] : selectedSources,
      testFiles: forceFullVitest ? [] : selectedTests,
      groups: forceFullVitest ? [...ALL_VITEST_GROUPS] : selectedGroups,
    },
    e2e: {
      mode: e2eMode,
      testFiles: selectedE2e,
      matrix:
        e2eMode === "none"
          ? [{ project: "none" }]
          : policy.e2eProjects.map((project) => ({ project })),
    },
    cacheScope: cacheScopeFor(input),
    reasons: sortedUnique(reasons),
    unknownPaths: sortedUnique(unknownPaths),
  };
}

export interface GitChangeSet {
  changedPaths: string[];
  deletedPaths: string[];
}

export function parseNameStatusDiff(output: string): GitChangeSet {
  const tokens = output.split("\0").filter((token) => token.length > 0);
  const paths: string[] = [];
  const deletedPaths: string[] = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index] ?? "";
    index += 1;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = tokens[index];
      const newPath = tokens[index + 1];
      index += 2;
      if (oldPath !== undefined) {
        const normalizedOldPath = normalizeRepoPath(oldPath);
        paths.push(normalizedOldPath);
        if (status.startsWith("R")) deletedPaths.push(normalizedOldPath);
      }
      if (newPath !== undefined) paths.push(normalizeRepoPath(newPath));
      continue;
    }
    const file = tokens[index];
    index += 1;
    if (file !== undefined) {
      const normalizedFile = normalizeRepoPath(file);
      paths.push(normalizedFile);
      if (status.startsWith("D")) deletedPaths.push(normalizedFile);
    }
  }
  return { changedPaths: sortedUnique(paths), deletedPaths: sortedUnique(deletedPaths) };
}

export function collectChangedPaths(
  repoRoot: string,
  baseSha: string,
  headSha: string,
): GitChangeSet {
  const mergeBase = execFileSync("git", ["merge-base", baseSha, headSha], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (mergeBase.length === 0) {
    throw new Error("git merge-base returned no commit");
  }
  const output = execFileSync(
    "git",
    ["diff", "--name-status", "-z", "--find-renames", mergeBase, headSha],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return parseNameStatusDiff(output);
}

function listOrNone(values: string[]): string {
  return values.length === 0 ? "_none_" : values.map((value) => `- \`${value}\``).join("\n");
}

export function renderImpactSummary(plan: ImpactPlan): string {
  return [
    "## Test impact plan",
    "",
    `- Mode: **${plan.mode}**`,
    `- Event: \`${plan.event}\``,
    `- Comparison: \`${plan.baseSha ?? "unavailable"}\` → \`${plan.headSha}\``,
    `- Cache trust scope: \`${plan.cacheScope}\``,
    `- Vitest: **${plan.vitest.mode}** (${plan.vitest.groups.join(", ") || "no groups"})`,
    `- E2E: **${plan.e2e.mode}**`,
    "",
    "### Changed paths",
    "",
    listOrNone(plan.changedPaths),
    "",
    "### Deleted paths",
    "",
    listOrNone(plan.deletedPaths),
    "",
    "### Direct Vitest files",
    "",
    listOrNone(plan.vitest.testFiles),
    "",
    "### Vitest relationship inputs",
    "",
    listOrNone(plan.vitest.sourceFiles),
    "",
    "### E2E journeys",
    "",
    listOrNone(plan.e2e.testFiles),
    "",
    "### Reasons",
    "",
    listOrNone(plan.reasons),
    "",
  ].join("\n");
}

interface CliOptions {
  event: string;
  ref: string;
  baseSha: string | null;
  headSha: string;
  pullRequestNumber: string | null;
  changedPaths: string[];
  deletedPaths: string[];
  output: string;
}

function parseCli(argv: string[]): CliOptions {
  const values = new Map<string, string[]>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined || !argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${String(argument)}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    const key = argument.slice(2);
    values.set(key, [...(values.get(key) ?? []), value]);
    index += 1;
  }
  const one = (key: string, fallback = ""): string => values.get(key)?.at(-1) ?? fallback;
  const nullable = (key: string): string | null => {
    const value = one(key);
    return value.length === 0 ? null : value;
  };
  return {
    event: one("event", process.env["GITHUB_EVENT_NAME"] ?? "workflow_dispatch"),
    ref: one("ref", process.env["GITHUB_REF"] ?? ""),
    baseSha: nullable("base"),
    headSha: one("head", process.env["GITHUB_SHA"] ?? "unknown"),
    pullRequestNumber: nullable("pr-number"),
    changedPaths: values.get("changed") ?? [],
    deletedPaths: values.get("deleted") ?? [],
    output: one("output", "test-impact.json"),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  const options = parseCli(argv);
  const policy = loadImpactPolicy(repoRoot);
  const policyFailures = validateImpactPolicy(policy, repoRoot);
  if (policyFailures.length > 0) {
    throw new Error(`Impact policy validation failed:\n- ${policyFailures.join("\n- ")}`);
  }

  let baseSha = options.baseSha;
  let changedPaths = options.changedPaths;
  let deletedPaths = options.deletedPaths;
  if (options.event === "pull_request" && changedPaths.length === 0 && baseSha !== null) {
    try {
      const changeSet = collectChangedPaths(repoRoot, baseSha, options.headSha);
      changedPaths = changeSet.changedPaths;
      deletedPaths = changeSet.deletedPaths;
    } catch (error) {
      console.warn(`Could not establish the pull-request change set: ${String(error)}`);
      baseSha = null;
    }
  }

  const plan = createImpactPlan(policy, {
    event: options.event,
    ref: options.ref,
    baseSha,
    headSha: options.headSha,
    pullRequestNumber: options.pullRequestNumber,
    changedPaths,
    deletedPaths,
  });
  const outputPath = path.resolve(repoRoot, options.output);
  writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const githubOutput = process.env["GITHUB_OUTPUT"];
  if (githubOutput !== undefined) {
    const groupMode = (group: VitestGroup): string =>
      plan.vitest.groups.includes(group) ? plan.vitest.mode : "none";
    appendFileSync(
      githubOutput,
      [
        `mode=${plan.mode}`,
        `unit_mode=${groupMode("unit")}`,
        `integration_mode=${groupMode("integration")}`,
        `contract_mode=${groupMode("contract")}`,
        `e2e_mode=${plan.e2e.mode}`,
        `e2e_matrix=${JSON.stringify(plan.e2e.matrix)}`,
        `cache_scope=${plan.cacheScope}`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
  const summary = renderImpactSummary(plan);
  const githubSummary = process.env["GITHUB_STEP_SUMMARY"];
  if (githubSummary !== undefined) {
    appendFileSync(githubSummary, summary, "utf8");
  }
  console.info(summary);
}

const entryPoint =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (entryPoint === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
