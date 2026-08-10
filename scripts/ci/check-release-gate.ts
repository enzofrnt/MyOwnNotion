/**
 * Release-gate evidence check (feature 002, FR-033 – FR-035).
 *
 * Publication is eligible only when the quality gate succeeded for *this exact
 * commit* in the same run. This script is the machine-checkable form of that
 * rule and refuses on missing, stale, foreign-commit, or artifact-less
 * evidence. It never publishes anything itself.
 *
 * Inputs (environment):
 *   CANDIDATE_SHA   the SHA the quality gate ran on (from the gate job output)
 *   GITHUB_SHA      the SHA of the current run
 *   GATE_RESULT     the aggregate `quality-gate` job result
 *   RELEASE_TAG     optional; when set it must match ^v[0-9]+\.[0-9]+\.[0-9]+$
 *   GATE_ARTIFACT_DIR  directory holding the required gate artifacts
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** Every artifact a candidate must produce before any publication job runs. */
const requiredArtifacts = [
  "dependency-audit.json",
  "secret-scan.sarif",
  "static-security.sarif",
  "container-scan.sarif",
  "license-policy.json",
  "image-build.json",
];

const strictVersionTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

const failures: string[] = [];

const candidateSha = (process.env["CANDIDATE_SHA"] ?? "").trim();
const currentSha = (process.env["GITHUB_SHA"] ?? "").trim();
const gateResult = (process.env["GATE_RESULT"] ?? "").trim();
const releaseTag = (process.env["RELEASE_TAG"] ?? "").trim();
const artifactDir = path.resolve(repoRoot, process.env["GATE_ARTIFACT_DIR"] ?? ".");

// 1. The gate must have actually succeeded. Missing, skipped, cancelled, and
//    failed are all blocking; an absent value is blocking too.
if (gateResult !== "success") {
  failures.push(
    `quality-gate result must be "success" (found: ${gateResult === "" ? "(missing)" : gateResult})`,
  );
}

// 2. The gate evidence must belong to this commit; stale or foreign evidence
//    cannot authorise a publication.
if (candidateSha.length === 0) {
  failures.push("CANDIDATE_SHA is missing: no gate evidence is attached to this run");
} else if (currentSha.length === 0) {
  failures.push("GITHUB_SHA is missing: the current commit cannot be verified");
} else if (candidateSha !== currentSha) {
  failures.push(
    `gate evidence is for a different commit (candidate ${candidateSha}, current ${currentSha})`,
  );
}

// 3. A tagged release must use the strict version-tag pattern.
if (releaseTag.length > 0 && !strictVersionTag.test(releaseTag)) {
  failures.push(
    `release tag must match ^v[0-9]+.[0-9]+.[0-9]+$ (found: ${releaseTag}); pre-release and suffixed tags are not eligible`,
  );
}

// 4. Every declared artifact must exist and be non-empty.
for (const artifact of requiredArtifacts) {
  const artifactPath = path.join(artifactDir, artifact);
  if (!existsSync(artifactPath)) {
    failures.push(`required gate artifact is missing: ${artifact}`);
    continue;
  }
  if (statSync(artifactPath).size === 0) {
    failures.push(`required gate artifact is empty: ${artifact}`);
  }
}

if (failures.length > 0) {
  console.error("Release gate check failed — publication is blocked:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.info(
  `Release gate check passed for ${currentSha}${releaseTag ? ` (${releaseTag})` : ""}: ` +
    `${requiredArtifacts.length} artifacts present, gate result success.`,
);
