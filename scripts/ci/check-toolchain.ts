/**
 * Repository toolchain policy gate.
 *
 * Enforced policies (constitution principle VII, plan "Development Toolchain"):
 * 1. pnpm is the only Node.js package manager: the exact release is pinned in
 *    root package metadata, `pnpm-lock.yaml` is committed, and foreign
 *    lockfiles (npm, Yarn, Bun) are rejected anywhere in the tree.
 * 2. Maintained source is TypeScript only: first-party `.js`/`.jsx`/`.cjs`/
 *    `.mjs` files are rejected outside generated output and vendored trees.
 * 3. Python, when introduced, must be uv-managed: any tracked `.py` file
 *    requires `pyproject.toml`, `uv.lock`, and `.python-version`, and
 *    non-uv dependency manifests (requirements.txt, Pipfile, poetry locks,
 *    conda environments) are rejected.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

const failures: string[] = [];

function trackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}

const files = trackedFiles();

// Policy 1a: exact pnpm pin in root package metadata.
const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  packageManager?: string;
};
if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootPackageJson.packageManager ?? "")) {
  failures.push(
    `package.json "packageManager" must pin an exact pnpm release (found: ${String(
      rootPackageJson.packageManager,
    )})`,
  );
}

// Policy 1b: committed pnpm lockfile.
if (!existsSync(path.join(repoRoot, "pnpm-lock.yaml"))) {
  failures.push("pnpm-lock.yaml must be committed at the repository root");
}

// Policy 1c: no foreign Node.js lockfiles anywhere.
const foreignLockfiles = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];
for (const file of files) {
  const base = path.basename(file);
  if (foreignLockfiles.includes(base)) {
    failures.push(`foreign package-manager lockfile is forbidden: ${file}`);
  }
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

if (failures.length > 0) {
  console.error("Toolchain policy check failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.info(`Toolchain policy check passed (${files.length} tracked files).`);
