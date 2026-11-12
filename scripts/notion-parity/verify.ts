#!/usr/bin/env bun
/**
 * One-command, repeatable parity gate for one surface.
 *
 *   bun run notion:parity:verify --config scripts/notion-parity/surfaces/property-menu.json
 *
 * A config names the reference and candidate recipes, selectors, profiles and
 * explicitly declared out-of-scope items. The command captures both surfaces,
 * compares every item's structure and geometry, writes the evidence, and exits
 * non-zero when the in-scope parity gate fails.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** One side of the comparison: how to reach and frame a surface. */
interface SurfaceConfig {
  readonly profile: string;
  readonly url: string;
  readonly steps: string;
  readonly selector: string;
  readonly item: string;
}

/** The `surfaces/<name>.json` document consumed by this command. */
interface ParityConfig {
  readonly name: string;
  readonly outDir?: string;
  readonly reference: SurfaceConfig;
  readonly candidate: SurfaceConfig;
  readonly outOfScope?: readonly string[];
}

/** `--flag value` yields the value; `--flag` alone yields `true`. */
type CliValue = string | true;
type CliArgs = Record<string, CliValue>;

function parseArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === undefined || !key.startsWith("--")) continue;
    const name = key.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) parsed[name] = true;
    else {
      parsed[name] = value;
      index += 1;
    }
  }
  return parsed;
}

const args = parseArgs(process.argv);
const configArg = args["config"];
if (configArg === undefined || configArg === true || configArg === "") {
  console.error("Missing --config");
  process.exit(2);
}
const configPath = resolve(configArg);
const config = JSON.parse(await readFile(configPath, "utf8")) as ParityConfig;
const out = resolve(config.outDir ?? `.notion-lab/parity/${config.name}`);
const referenceOut = resolve(out, "reference");
const candidateOut = resolve(out, "candidate");
const comparisonOut = resolve(out, "comparison.md");
await mkdir(out, { recursive: true });

function run(command: string, commandArgs: readonly string[]): void {
  const result = spawnSync(command, [...commandArgs], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function capture(surface: SurfaceConfig, output: string): void {
  run("bun", [
    "scripts/notion-parity/capture.ts",
    "--profile",
    surface.profile,
    "--url",
    surface.url,
    "--steps",
    surface.steps,
    "--selector",
    surface.selector,
    "--item",
    surface.item,
    "--out",
    output,
  ]);
}

capture(config.reference, referenceOut);
capture(config.candidate, candidateOut);
run("bun", [
  "scripts/notion-parity/compare.ts",
  "--reference",
  resolve(referenceOut, "capture.json"),
  "--candidate",
  resolve(candidateOut, "capture.json"),
  "--out-of-scope",
  (config.outOfScope ?? []).join(","),
  "--out",
  comparisonOut,
  "--fail-on-gap",
]);
await writeFile(
  resolve(out, "manifest.json"),
  JSON.stringify(
    {
      name: config.name,
      config: configPath,
      reference: resolve(referenceOut, "capture.json"),
      candidate: resolve(candidateOut, "capture.json"),
      comparison: comparisonOut,
      outOfScope: config.outOfScope ?? [],
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
process.stdout.write(
  `Measured checks passed for ${config.name}; visual review still required. Evidence: ${out}\n`,
);
