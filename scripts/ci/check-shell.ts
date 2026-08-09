/**
 * Tracked Bash quality gate.
 *
 * Runs pinned ShellCheck and shfmt against every tracked shell script,
 * without rewriting any file (`shfmt -d` reports diffs only). In CI the tool
 * versions must match the pinned releases exactly; locally a mismatched
 * version fails with a clear remediation message so contributors cannot
 * silently drift.
 *
 * Narrow, recorded exception (plan.md, Development Toolchain): scripts under
 * `.specify/scripts/bash/` are the upstream Spec Kit workflow scripts. They
 * are still checked and any finding is printed, but findings there do not
 * fail the gate — we do not own their formatting/style and must not rewrite
 * them. Findings in every first-party script still fail the gate.
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const PINNED_SHELLCHECK = "0.11.0";
const PINNED_SHFMT = "3.12.0";
const VENDORED_SPEC_KIT_PREFIX = ".specify/scripts/bash/";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function trackedShellScripts(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "*.sh"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}

function toolVersion(command: string, args: string[], pattern: RegExp): string | null {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  const match = pattern.exec(`${result.stdout}\n${result.stderr}`);
  return match?.[1] ?? null;
}

const scripts = trackedShellScripts();
if (scripts.length === 0) {
  console.info("No tracked shell scripts found; shell check passed.");
  process.exit(0);
}

const failures: string[] = [];

const shellcheckVersion = toolVersion("shellcheck", ["--version"], /version: (\d+\.\d+\.\d+)/);
const shfmtVersion = toolVersion("shfmt", ["--version"], /v?(\d+\.\d+\.\d+)/);

if (shellcheckVersion === null) {
  failures.push(`shellcheck ${PINNED_SHELLCHECK} is required but was not found on PATH`);
} else if (shellcheckVersion !== PINNED_SHELLCHECK) {
  failures.push(
    `shellcheck version mismatch: pinned ${PINNED_SHELLCHECK}, found ${shellcheckVersion}`,
  );
}
if (shfmtVersion === null) {
  failures.push(`shfmt ${PINNED_SHFMT} is required but was not found on PATH`);
} else if (shfmtVersion !== PINNED_SHFMT) {
  failures.push(`shfmt version mismatch: pinned ${PINNED_SHFMT}, found ${shfmtVersion}`);
}

if (failures.length === 0) {
  const ownedScripts = scripts.filter((script) => !script.startsWith(VENDORED_SPEC_KIT_PREFIX));
  const vendoredScripts = scripts.filter((script) => script.startsWith(VENDORED_SPEC_KIT_PREFIX));

  const shellcheckResult = spawnSync(
    "shellcheck",
    ["--severity=style", "--external-sources", ...scripts],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] },
  );
  if (shellcheckResult.status !== 0 && ownedScripts.length > 0) {
    const ownedResult = spawnSync(
      "shellcheck",
      ["--severity=style", "--external-sources", ...ownedScripts],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] },
    );
    if (ownedResult.status !== 0) {
      failures.push("shellcheck reported findings in first-party scripts (see output above)");
    } else {
      console.info(
        "shellcheck findings above are confined to vendored .specify/scripts/bash/ — not failing the gate.",
      );
    }
  }

  // -d prints diffs without modifying files, keeping managed Spec Kit
  // scripts untouched as required by the plan.
  const shfmtResult = spawnSync("shfmt", ["-i", "4", "-ci", "-d", ...scripts], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (shfmtResult.status !== 0 && ownedScripts.length > 0) {
    const ownedFmt = spawnSync("shfmt", ["-i", "4", "-ci", "-d", ...ownedScripts], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    if (ownedFmt.status !== 0) {
      failures.push(
        "shfmt reported formatting differences in first-party scripts (see diff above)",
      );
    } else if (vendoredScripts.length > 0) {
      console.info(
        "shfmt differences above are confined to vendored .specify/scripts/bash/ — not failing the gate.",
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Shell quality gate failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.info(`Shell quality gate passed for ${scripts.length} scripts.`);
