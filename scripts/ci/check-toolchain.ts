/**
 * Repository toolchain policy gate.
 *
 * Enforced policies (constitution principle VII, plan "Development Toolchain"):
 * 1. Bun is the only JavaScript/TypeScript runtime and package manager: the
 *    exact release is pinned in root metadata, `bun.lock` is committed, and
 *    foreign lockfiles are rejected anywhere in the tree.
 * 2. Maintained source is TypeScript only: first-party `.js`/`.jsx`/`.cjs`/
 *    `.mjs` files are rejected outside generated output and vendored trees.
 * 3. Python, when introduced, must be uv-managed: any tracked `.py` file
 *    requires `pyproject.toml`, `uv.lock`, and `.python-version`, and
 *    non-uv dependency manifests (requirements.txt, Pipfile, poetry locks,
 *    conda environments) are rejected.
 * 4. The delivery gate inventory is stable: the local-checks -> pull-request ->
 *    `main` path always resolves to the same named root scripts, so the gate
 *    cannot silently lose a check (feature 002, FR-033/FR-035).
 * 5. Tracked text is LF only: `.gitattributes` pins `eol=lf`, and a CR byte
 *    in a text file fails the gate (bash and several contract parsers treat
 *    `\r` as part of the token).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const EXPECTED_BUN_VERSION = "1.4.0";
const failures: string[] = [];

if (Bun.version !== EXPECTED_BUN_VERSION) {
  failures.push(`Bun ${EXPECTED_BUN_VERSION} is required exactly (running: ${Bun.version})`);
}

if (process.argv.includes("--version-only")) {
  if (failures.length > 0) {
    console.error(failures[0]);
    process.exit(1);
  }
  console.info(`Bun ${EXPECTED_BUN_VERSION} is active.`);
  process.exit(0);
}

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}

const files = trackedFiles().filter((file) => existsSync(path.join(repoRoot, file)));

// Policy 1a: exact Bun pin in root package metadata.
const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  packageManager?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[];
};
if (rootPackageJson.packageManager !== `bun@${EXPECTED_BUN_VERSION}`) {
  failures.push(
    `package.json "packageManager" must be "bun@${EXPECTED_BUN_VERSION}" (found: ${String(
      rootPackageJson.packageManager,
    )})`,
  );
}
if (rootPackageJson.engines?.["bun"] !== EXPECTED_BUN_VERSION) {
  failures.push(
    `package.json "engines.bun" must be "${EXPECTED_BUN_VERSION}" (found: ${String(
      rootPackageJson.engines?.["bun"],
    )})`,
  );
}
if (JSON.stringify(rootPackageJson.workspaces) !== JSON.stringify(["apps/*", "packages/*"])) {
  failures.push('package.json "workspaces" must be exactly ["apps/*", "packages/*"]');
}

// Policy 1b: committed text Bun lockfile and runtime forcing.
if (!existsSync(path.join(repoRoot, "bun.lock"))) {
  failures.push("bun.lock must be committed at the repository root");
}
const bunfigPath = path.join(repoRoot, "bunfig.toml");
if (
  !existsSync(bunfigPath) ||
  !/^\[run\]\s+bun\s*=\s*true\s*$/m.test(readFileSync(bunfigPath, "utf8"))
) {
  failures.push("bunfig.toml must force package executables to run with Bun");
}

// Policy 1c: no foreign JavaScript package-manager metadata anywhere.
const foreignLockfiles = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lockb",
];
for (const file of new Set([...files, ...foreignLockfiles])) {
  const base = path.basename(file);
  if (foreignLockfiles.includes(base) && existsSync(path.join(repoRoot, file))) {
    failures.push(`foreign package-manager lockfile is forbidden: ${file}`);
  }
}
if (existsSync(path.join(repoRoot, ".npmrc"))) {
  failures.push("root .npmrc from the retired package-manager policy is forbidden");
}

// Policy 2: TypeScript-only first-party source.
const generatedPrefixes = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".specify/",
  ".agents/",
  ".cursor/",
];
const jsPattern = /\.(js|jsx|cjs|mjs)$/;
for (const file of files) {
  if (!jsPattern.test(file)) {
    continue;
  }
  if (generatedPrefixes.some((prefix) => file.startsWith(prefix) || file.includes(`/${prefix}`))) {
    continue;
  }
  failures.push(`first-party JavaScript source is forbidden (TypeScript only): ${file}`);
}

// Policy 3: uv-managed Python only.
const pythonSources = files.filter(
  (file) =>
    file.endsWith(".py") &&
    !generatedPrefixes.some((prefix) => file.startsWith(prefix) || file.includes(`/${prefix}`)),
);
if (pythonSources.length > 0) {
  for (const required of ["pyproject.toml", "uv.lock", ".python-version"]) {
    if (!existsSync(path.join(repoRoot, required))) {
      failures.push(
        `first-party Python detected (${pythonSources[0]}) but uv artifact is missing: ${required}`,
      );
    }
  }
}
const forbiddenPythonManifests = [
  "requirements.txt",
  "requirements-dev.txt",
  "Pipfile",
  "Pipfile.lock",
  "poetry.lock",
  "environment.yml",
  "setup.py",
];
for (const file of files) {
  if (forbiddenPythonManifests.includes(path.basename(file))) {
    failures.push(`non-uv Python dependency manifest is forbidden: ${file}`);
  }
}

// Policy 4a: root scripts may orchestrate specialized tools, but never invoke
// a retired runtime or package manager directly.
const forbiddenCommand = /(?:^|(?:&&|\|\||;|\|)\s*)(?:node|npx|npm|pnpm|yarn|corepack|tsx)(?:\s|$)/;
for (const [name, command] of Object.entries(rootPackageJson.scripts ?? {})) {
  if (forbiddenCommand.test(command)) {
    failures.push(`package.json "scripts.${name}" invokes a retired executable: ${command}`);
  }
}

// Policy 4b: the gate script inventory shared by local checks, the pull-request
// gate, and the `main` gate. Names are contractual: `.github/workflows/ci.yml`
// and `docs/development.md` reference exactly these.
const requiredGateScripts = [
  // Toolchain and style
  "toolchain:check",
  "ci:test-impact",
  "ci:test:affected",
  "shell:check",
  "format:check",
  "lint:ci",
  "typecheck",
  // Test tiers
  "test:unit",
  "test:property",
  "test:integration",
  "test:contract",
  "test:migration",
  "test:e2e",
  "test:e2e:local",
  "test:security",
  // Security gate jobs
  "security:audit",
  "security:secrets",
  "security:static",
  "security:licenses",
  // Build, deployment, and release gates
  "build",
  "compose:check",
  "images:build",
  "release:gate",
  // Aggregate pre-push entry point
  "checks:local",
];
for (const script of requiredGateScripts) {
  if (typeof rootPackageJson.scripts?.[script] !== "string") {
    failures.push(`package.json "scripts.${script}" is required by the delivery gate inventory`);
  }
}

const { collectDesktopFailures } = await import("./check-desktop.ts");
failures.push(...collectDesktopFailures());

// Policy 5: no first-party source file is silently ignored.
//
// A broad `.gitignore` glob can swallow a source file and its tests without
// any signal: the build still passes, the tests still pass locally, and CI
// reports green because the code it would have exercised is not in the
// repository at all. That happened with `deployment-key*`, which matched
// `deployment-key.ts` and kept a module plus 28 tests out of the tree.
const sourceRoots = ["apps", "packages", "scripts", "tests"];
const sourceExtensions = /\.(ts|tsx)$/;
const ignoredSources: string[] = [];
try {
  // `--others --ignored --exclude-standard` lists exactly the files git is
  // hiding, which is the set that would otherwise disappear unnoticed.
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...sourceRoots],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  for (const file of output.split("\0").filter((entry) => entry.length > 0)) {
    if (!sourceExtensions.test(file)) {
      continue;
    }
    if (file.includes("node_modules/") || file.includes("/dist/") || file.startsWith("dist/")) {
      continue;
    }
    ignoredSources.push(file);
  }
} catch {
  // A git failure here is itself a problem worth surfacing rather than
  // skipping the policy.
  failures.push("could not enumerate ignored files to verify no source is hidden");
}
for (const file of ignoredSources) {
  failures.push(
    `first-party source file is excluded by .gitignore and would never reach the repository: ${file}`,
  );
}

// Policy 5: LF line endings only.
const gitAttributesPath = path.join(repoRoot, ".gitattributes");
const gitAttributes = existsSync(gitAttributesPath) ? readFileSync(gitAttributesPath, "utf8") : "";
if (!/^\*\s+text=auto\s+eol=lf\s*$/m.test(gitAttributes)) {
  failures.push(".gitattributes must pin `* text=auto eol=lf` so checkouts stay LF");
}
const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".wasm",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".7z",
]);
const crlfFiles: string[] = [];
for (const file of files) {
  if (binaryExtensions.has(path.extname(file).toLowerCase())) {
    continue;
  }
  const bytes = readFileSync(path.join(repoRoot, file));
  if (bytes.includes(0)) {
    continue;
  }
  if (bytes.includes(0x0d)) {
    crlfFiles.push(file);
  }
}
for (const file of crlfFiles.slice(0, 20)) {
  failures.push(`CRLF or bare CR in tracked text file (LF only): ${file}`);
}
if (crlfFiles.length > 20) {
  failures.push(`…and ${crlfFiles.length - 20} more tracked text files with CR`);
}

if (failures.length > 0) {
  console.error("Toolchain policy check failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.info(`Toolchain policy check passed (${files.length} tracked files).`);
