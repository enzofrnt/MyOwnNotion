/**
 * License policy gate (feature 002, FR-033/FR-035).
 *
 * Blocking rule: any denied license, any dependency with no resolvable
 * license, or any failure of the policy check blocks the quality gate. A
 * self-hosted single-owner product must not ship copyleft-network or
 * unknown-licensed production dependencies.
 *
 * Output artifact: `license-policy.json`, always written.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const artifactPath = path.join(repoRoot, "license-policy.json");

/**
 * SPDX identifiers permitted for production dependencies.
 *
 * Feature 017 relies on MIT foundations (Loro, Tailwind, Ariakit, dnd-kit and
 * Lucide) and MPL-2.0 BlockNote Community packages. Feature 018 adds the MIT
 * Fastify WebSocket adapter without adding a hosted synchronization runtime.
 * Those grants permit the self-hosted product while preserving their
 * respective attribution terms.
 */
const allowedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

/** Explicitly denied, listed so the failure message names the reason. */
const deniedLicenses = new Map([
  ["AGPL-1.0", "network copyleft"],
  ["AGPL-3.0", "network copyleft"],
  ["AGPL-3.0-only", "network copyleft"],
  ["AGPL-3.0-or-later", "network copyleft"],
  ["GPL-2.0", "strong copyleft"],
  ["GPL-3.0", "strong copyleft"],
  ["GPL-3.0-only", "strong copyleft"],
  ["GPL-3.0-or-later", "strong copyleft"],
  ["SSPL-1.0", "server-side public license"],
  ["BUSL-1.1", "non-open source-available"],
  ["Commons-Clause", "commercial-use restriction"],
  ["UNLICENSED", "proprietary, no grant"],
]);

interface BunLicenseEntry {
  name: string;
  version?: string;
  versions?: string[];
  license?: string;
  paths?: string[];
}

interface Violation {
  name: string;
  versions: string[];
  license: string;
  reason: string;
}

function readLicenses(): Record<string, BunLicenseEntry[]> {
  const raw = execFileSync("bun", ["pm", "licenses", "--prod", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw) as Record<string, BunLicenseEntry[]>;
}

/**
 * `MIT OR Apache-2.0` passes when either side passes; `MIT AND GPL-3.0` passes
 * only when both do. Parentheses in SPDX expressions are stripped because the
 * expressions produced by the registry are flat in practice.
 */
function evaluateExpression(expression: string): { ok: boolean; offender?: string } {
  const normalized = expression.replaceAll("(", " ").replaceAll(")", " ").trim();
  if (normalized.length === 0) {
    return { ok: false, offender: "(empty)" };
  }
  if (/\bOR\b/i.test(normalized)) {
    const options = normalized.split(/\s+OR\s+/i).map((part) => part.trim());
    const passing = options.find((option) => evaluateExpression(option).ok);
    return passing ? { ok: true } : { ok: false, offender: normalized };
  }
  if (/\bAND\b/i.test(normalized)) {
    const parts = normalized.split(/\s+AND\s+/i).map((part) => part.trim());
    for (const part of parts) {
      const result = evaluateExpression(part);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }
  const identifier = normalized.replace(/\+$/, "");
  return allowedLicenses.has(identifier) ? { ok: true } : { ok: false, offender: identifier };
}

let byLicense: Record<string, BunLicenseEntry[]>;
try {
  byLicense = readLicenses();
} catch (error) {
  // An unavailable check is a blocking failure, never a silent pass.
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(
    artifactPath,
    `${JSON.stringify({ status: "error", error: message }, null, 2)}\n`,
    "utf8",
  );
  console.error(`License policy check could not run: ${message}`);
  process.exit(1);
}

const violations: Violation[] = [];
const summary: Record<string, number> = {};
let packageCount = 0;

for (const [license, entries] of Object.entries(byLicense)) {
  summary[license] = (summary[license] ?? 0) + entries.length;
  packageCount += entries.length;

  const unknown = license === "Unknown" || license.trim().length === 0;
  const denied = deniedLicenses.get(license.trim());
  const evaluation = unknown ? { ok: false, offender: "Unknown" } : evaluateExpression(license);

  if (unknown || denied !== undefined || !evaluation.ok) {
    for (const entry of entries) {
      violations.push({
        name: entry.name,
        versions: entry.versions ?? (entry.version ? [entry.version] : []),
        license,
        reason: unknown
          ? "no resolvable license (attribution missing)"
          : (denied ?? `license not on the allowlist (${evaluation.offender})`),
      });
    }
  }
}

writeFileSync(
  artifactPath,
  `${JSON.stringify(
    {
      status: violations.length === 0 ? "pass" : "fail",
      scope: "production dependencies (bun pm licenses --prod)",
      packageCount,
      licenseSummary: summary,
      violations,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

if (violations.length > 0) {
  console.error(`License policy failed: ${violations.length} violation(s).\n`);
  for (const violation of violations) {
    console.error(
      `  - ${violation.name}@${violation.versions.join(",") || "?"}: ${violation.license} — ${violation.reason}`,
    );
  }
  console.error(`\nArtifact: ${path.relative(repoRoot, artifactPath)}`);
  process.exit(1);
}

console.info(`License policy passed (${packageCount} production packages, 0 violations).`);
