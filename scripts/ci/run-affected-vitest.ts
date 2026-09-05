import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { ImpactPlan, VitestGroup } from "./test-impact.js";

export type Command = readonly [command: string, arguments_: string[]];

const PROJECTS: Record<VitestGroup, string[]> = {
  unit: ["domain", "page-state", "contracts", "blob-store", "client-core", "web", "desktop"],
  integration: ["database-integration"],
  contract: ["api-contract", "workspace-contract"],
  performance: ["performance"],
};

function groupForTest(file: string): VitestGroup {
  if (file.startsWith("tests/performance/")) {
    return "performance";
  }
  if (file.startsWith("tests/contract/") || file.startsWith("apps/api/")) {
    return "contract";
  }
  if (file.startsWith("packages/database/")) {
    return "integration";
  }
  return "unit";
}

export function commandsForVitestGroup(plan: ImpactPlan, group: VitestGroup): Command[] {
  if (!plan.vitest.groups.includes(group) || plan.vitest.mode === "none") {
    return [];
  }
  if (plan.vitest.mode === "full") {
    if (group === "unit") return [["bun", ["run", "test:coverage"]]];
    if (group === "integration") {
      return [
        ["bun", ["run", "test:integration"]],
        ["bun", ["run", "db:test-migrations"]],
      ];
    }
    if (group === "performance") return [["bun", ["run", "test:performance"]]];
    return [["bun", ["run", "test:contract"]]];
  }

  const commands: Command[] = [];
  if (plan.vitest.sourceFiles.length > 0) {
    const projects = PROJECTS[group];
    if (projects === undefined) throw new Error(`No Vitest projects declared for ${group}`);
    const projectArguments = projects.flatMap((project) => ["--project", project]);
    commands.push(
      vitestCommand(group, [
        "related",
        "--run",
        "--passWithNoTests",
        ...projectArguments,
        ...plan.vitest.sourceFiles,
      ]),
    );
  }

  const directTests = plan.vitest.testFiles.filter((file) => groupForTest(file) === group);
  if (directTests.length > 0) {
    commands.push(vitestCommand(group, ["run", "--passWithNoTests", ...directTests]));
  }
  return commands;
}

function vitestCommand(group: VitestGroup, arguments_: string[]): Command {
  const boundedArguments = group === "performance" ? [...arguments_, "--maxWorkers=1"] : arguments_;
  return group === "unit"
    ? ["bun", ["run", "--bun", "vitest", ...boundedArguments]]
    : ["bun", ["scripts/ci/run-vitest-with-postgres.ts", ...boundedArguments]];
}

function parseCli(argv: string[]): { planPath: string; group: VitestGroup } {
  let planPath = "test-impact.json";
  let group: VitestGroup | null = null;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${String(flag)}`);
    if (flag === "--plan") planPath = value;
    else if (
      flag === "--group" &&
      ["unit", "integration", "contract", "performance"].includes(value)
    ) {
      group = value as VitestGroup;
    } else throw new Error(`Unexpected argument: ${String(flag)} ${value}`);
  }
  if (group === null) {
    throw new Error("--group must be unit, integration, contract, or performance");
  }
  return { planPath, group };
}

export function main(argv = process.argv.slice(2)): void {
  const { planPath, group } = parseCli(argv);
  const plan = JSON.parse(readFileSync(path.resolve(planPath), "utf8")) as ImpactPlan;
  const commands = commandsForVitestGroup(plan, group);
  if (commands.length === 0) {
    console.info(`No ${group} tests are impacted; required job succeeds as an explicit no-op.`);
    return;
  }
  for (const [command, arguments_] of commands) {
    console.info(`Running affected ${group} command: ${command} ${arguments_.join(" ")}`);
    const result = spawnSync(command, arguments_, { stdio: "inherit", env: process.env });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

const entryPoint =
  process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (entryPoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
