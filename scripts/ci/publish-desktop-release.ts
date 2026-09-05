/**
 * Publishes desktop artefacts only after the exact tag gate (feature 014, US5).
 *
 * This script never uploads when the tag, SHA, or artefact check is missing.
 * Secrets come from the runner environment, never from the repository.
 */
import process from "node:process";

const strictVersionTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

const tag = (process.env["RELEASE_TAG"] ?? "").trim();
const candidateSha = (process.env["CANDIDATE_SHA"] ?? "").trim();
const currentSha = (process.env["GITHUB_SHA"] ?? "").trim();
const artefactsOk = (process.env["DESKTOP_ARTIFACTS_OK"] ?? "").trim();
const signed = (process.env["DESKTOP_SIGNED"] ?? "").trim();

const failures: string[] = [];
if (!strictVersionTag.test(tag)) {
  failures.push(`RELEASE_TAG must be a strict version tag (found: ${tag || "(missing)"})`);
}
if (candidateSha.length === 0 || candidateSha !== currentSha) {
  failures.push("publication SHA must match the quality-gate candidate");
}
if (artefactsOk !== "1") {
  failures.push("DESKTOP_ARTIFACTS_OK=1 is required before publication");
}
if (signed !== "1") {
  failures.push("DESKTOP_SIGNED=1 is required before publication");
}

if (failures.length > 0) {
  console.error("Desktop publication refused:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.info(`Desktop publication gate passed for ${tag} at ${currentSha}.`);
