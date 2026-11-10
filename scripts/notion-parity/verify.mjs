#!/usr/bin/env node
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

const args = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const name = key.slice(2);
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) args[name] = true;
  else {
    args[name] = value;
    index += 1;
  }
}
if (!args.config) {
  console.error("Missing --config");
  process.exit(2);
}
const configPath = resolve(args.config);
const config = JSON.parse(await readFile(configPath, "utf8"));
const out = resolve(config.outDir ?? `.notion-lab/parity/${config.name}`);
const referenceOut = resolve(out, "reference");
const candidateOut = resolve(out, "candidate");
const comparisonOut = resolve(out, "comparison.md");
await mkdir(out, { recursive: true });

const run = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const capture = (surface, output) => {
  run("bun", [
    "scripts/notion-parity/capture.mjs",
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
};
capture(config.reference, referenceOut);
capture(config.candidate, candidateOut);
run("bun", [
  "scripts/notion-parity/compare.mjs",
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
