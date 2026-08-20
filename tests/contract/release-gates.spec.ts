/**
 * What the delivery gate must refuse (T093, T100, US6, FR-033 – FR-035, SC-007).
 *
 * These tests read `.github/workflows/ci.yml` as a document. That is unusual,
 * and it is the only way to check the one class of failure the workflow cannot
 * check about itself: **a required job that is simply absent.**
 *
 * The aggregate job compares every entry in `needs` against `success`, which
 * correctly refuses a job that failed, was skipped, or was cancelled. It cannot
 * refuse a job that is not in `needs` at all — that job would not appear in the
 * comparison, and its absence would look exactly like everything passing. So
 * the required set is asserted here, from outside.
 *
 * The second thing checked from outside is **who may publish**. A workflow that
 * granted `packages: write` broadly would let any job push an image, and the
 * gate would still be green. Permission is the control; the gate is the
 * evidence.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const ci = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
const gha = (expression: string): string => `\${{ ${expression} }}`;

/** The five security jobs FR-035 requires to be individually observable. */
const SECURITY_JOBS = [
  "dependency-vulnerability-audit",
  "secret-scan",
  "static-security-analysis",
  "container-vulnerability-scan",
  "license-policy",
] as const;

/** The artifact each one must leave behind. */
const SECURITY_ARTIFACTS = [
  "dependency-audit.json",
  "secret-scan.sarif",
  "static-security.sarif",
  "container-scan.sarif",
  "license-policy.json",
] as const;

/** The `needs:` list of the aggregate job, as written. */
function qualityGateNeeds(): readonly string[] {
  const block = /\n {2}quality-gate:\n([\s\S]*?)\n {4}if: always\(\)/.exec(ci);
  const needs = block?.[1] ?? "";
  return [...needs.matchAll(/^ {6}- ([a-z][a-z0-9-]*)$/gm)].map((match) => match[1] ?? "");
}

describe("the five security jobs", () => {
  it("each exists as its own job", () => {
    // One job running all five would be a single red X hiding which of five
    // very different problems occurred. A vulnerable dependency, a committed
    // secret, a dangerous pattern, a vulnerable base image and a forbidden
    // licence are not the same emergency and do not have the same fix.
    for (const job of SECURITY_JOBS) {
      expect(ci, `${job} is not a job`).toMatch(new RegExp(`^ {2}${job}:$`, "m"));
    }
  });

  it("each blocks the aggregate", () => {
    const needs = qualityGateNeeds();
    for (const job of SECURITY_JOBS) {
      expect(needs, `${job} does not block the gate`).toContain(job);
    }
  });

  it("each leaves an artifact behind", () => {
    for (const artifact of SECURITY_ARTIFACTS) {
      expect(ci, `${artifact} is never uploaded`).toContain(artifact);
    }
  });

  it("uploads its artifact even when the job failed", () => {
    // `if: always()` on every upload. An artifact that only exists on success
    // is evidence of nothing: the run an operator most needs to inspect is the
    // one that failed.
    const uploads = [...ci.matchAll(/\n( +)- if: always\(\)\n +uses: actions\/upload-artifact/g)];
    expect(uploads.length).toBeGreaterThanOrEqual(SECURITY_ARTIFACTS.length);
  });

  it("refuses to upload nothing", () => {
    // `if-no-files-found: error`. A job that produced no artifact and uploaded
    // successfully would be indistinguishable, downstream, from one that
    // produced a clean report.
    const errorOnMissing = [...ci.matchAll(/if-no-files-found: error/g)];
    expect(errorOnMissing.length).toBeGreaterThanOrEqual(SECURITY_ARTIFACTS.length);
  });
});

describe("the aggregate", () => {
  it("requires every build and test job as well", () => {
    const needs = qualityGateNeeds();
    for (const job of [
      "impact",
      "lint",
      "typecheck",
      "unit",
      "integration",
      "reference-backups",
      "contract",
      "e2e",
      "build",
    ]) {
      expect(needs, `${job} does not block the gate`).toContain(job);
    }
  });

  it("compares against success rather than excluding failure", () => {
    // The difference is what happens to `skipped` and `cancelled`. Excluding
    // only `failure` would let a skipped job through, and a skipped job
    // produced no evidence — a gate that reads "no evidence" as "no problem"
    // is not a gate.
    expect(ci).toMatch(/select\(\.value\.result != "success"\)/);
  });

  it("runs even when a job it depends on failed", () => {
    // Without `if: always()` the aggregate would be *skipped* when a
    // dependency fails, and a skipped required check is not a failed one — on
    // some branch-protection configurations it is simply never reported.
    const block = /\n {2}quality-gate:\n([\s\S]*?)\n {2}[a-z]/.exec(ci)?.[1] ?? "";
    expect(block).toContain("if: always()");
  });
});

describe("safe reusable work", () => {
  it("uses the lockfile-aware pnpm store cache", () => {
    expect(ci).toContain("cache: pnpm");
    expect(ci).toContain("pnpm install --frozen-lockfile");
  });

  it("keys Playwright browsers by runner and pinned runtime version", () => {
    expect(ci).toContain(
      `key: playwright-${gha("runner.os")}-${gha("runner.arch")}-${gha("steps.playwright-version.outputs.value")}`,
    );
    expect(ci).toContain("pnpm exec playwright install --with-deps");
  });

  it("provisions the protected-storage fixtures before migrating an E2E database", () => {
    const block = /\n {2}e2e:\n([\s\S]*?)\n {2}build:\n/.exec(ci)?.[1] ?? "";

    expect(block).toContain("Prepare disposable protected-storage fixtures");
    expect(block).toContain('myownnotion_e2e_root="$RUNNER_TEMP/myownnotion-e2e"');
    expect(block).toContain("printf 'MYOWNNOTION_DEPLOYMENT_KEY_FILE=%s\\n'");
    expect(block).toContain('} >> "$GITHUB_ENV"');
    expect(block).toContain('openssl rand -base64 32 > "$myownnotion_deployment_key_file"');
    expect(block).not.toContain(gha("runner.temp"));
    expect(block.indexOf("Prepare disposable protected-storage fixtures")).toBeLessThan(
      block.indexOf("pnpm db:migrate"),
    );
  });

  it("uses separate maximal BuildKit scopes for API and web", () => {
    expect(ci).toContain(
      `cache-from: type=gha,scope=api-${gha("needs.impact.outputs.cache_scope")}`,
    );
    expect(ci).toContain(
      `cache-to: type=gha,mode=max,scope=api-${gha("needs.impact.outputs.cache_scope")}`,
    );
    expect(ci).toContain(
      `cache-from: type=gha,scope=web-${gha("needs.impact.outputs.cache_scope")}`,
    );
    expect(ci).toContain(
      `cache-to: type=gha,mode=max,scope=web-${gha("needs.impact.outputs.cache_scope")}`,
    );
  });

  it("does not turn an unavailable cache export into gate evidence", () => {
    const exports = [...ci.matchAll(/^ +cache-to: (.+)$/gm)].map((match) => match[1] ?? "");
    expect(exports.length).toBeGreaterThan(0);
    expect(exports.every((entry) => entry.includes("ignore-error=true"))).toBe(true);
  });

  it("lets trusted main publication import only the main scope", () => {
    const block = /\n {2}publish-commit-images:\n([\s\S]*?)$/.exec(ci)?.[1] ?? "";
    expect(block).toContain("cache-from: type=gha,scope=api-main");
    expect(block).toContain("cache-from: type=gha,scope=web-main");
    expect(block).not.toContain("scope=api-pr-");
    expect(block).not.toContain("scope=web-pr-");
  });
});

describe("affected test topology", () => {
  it("retains and uploads the exact machine-readable plan", () => {
    expect(ci).toMatch(/^ {2}impact:$/m);
    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain("name: test-impact-plan");
    expect(ci).toContain("path: test-impact.json");
  });

  it("keeps required Vitest jobs present for empty selections", () => {
    expect(ci).toContain("No impacted unit tests");
    expect(ci).toContain("No impacted integration tests");
    expect(ci).toContain("No impacted contract tests");
    expect(ci).toContain("pnpm ci:test:affected --plan test-impact.json --group unit");
    expect(ci).toContain("pnpm ci:test:affected --plan test-impact.json --group integration");
    expect(ci).toContain("pnpm ci:test:affected --plan test-impact.json --group contract");
  });

  it("uses a dynamic E2E matrix with an explicit no-op sentinel", () => {
    expect(ci).toContain(`include: ${gha("fromJSON(needs.impact.outputs.e2e_matrix)")}`);
    expect(ci).toContain("if: matrix.project == 'none'");
    expect(ci).toContain(`playwright-report-${gha("matrix.project")}`);
  });

  it("cancels only superseded runs for the same pull request", () => {
    expect(ci).toContain("format('pr-{0}', github.event.pull_request.number)");
    expect(ci).toContain(`cancel-in-progress: ${gha("github.event_name == 'pull_request'")}`);
  });
});

describe("who may publish", () => {
  it("grants package writes to exactly one job", () => {
    // Permission is the control and the gate is the evidence. A workflow that
    // granted `packages: write` broadly would let any job push an image while
    // the gate stayed green.
    // Actual grants, not mentions: the file discusses `packages: write` in
    // two comments explaining where it is *not*, and counting those would make
    // this test fail for saying the right thing.
    const grants = [...ci.matchAll(/^ +packages: write$/gm)];
    expect(grants).toHaveLength(1);
  });

  it("keeps the workflow's own permissions read-only", () => {
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it("builds images on every candidate without publishing them", () => {
    // A pull request must exercise the build — an image that only builds on
    // `main` is an image whose build breaks on `main`. It must publish
    // nothing, and hold no permission to.
    const block = /\n {2}build-images:\n([\s\S]*?)\n {2}[a-z-]+:\n/.exec(ci)?.[1] ?? "";
    // Again the grant rather than the word: this job's comment says "No
    // `packages: write`", which is exactly the property being asserted.
    expect(block).not.toMatch(/^ +packages: write$/m);
    expect(block).not.toContain("--push");
  });

  it("embeds the immutable candidate identity in every API image", () => {
    const apiBuilds = [
      ...ci.matchAll(/file: docker\/api\.Dockerfile([\s\S]*?)(?=\n +(?:- name:|tags:))/g),
    ];
    expect(apiBuilds.length).toBeGreaterThanOrEqual(3);
    for (const build of apiBuilds) {
      expect(build[1], "an API image build omitted its immutable application version").toContain(
        `APPLICATION_VERSION=sha-${gha("github.sha")}`,
      );
    }
  });

  it("publishes only from a push to main, behind a successful gate", () => {
    const block = /\n {2}publish-commit-images:\n([\s\S]*?)$/.exec(ci)?.[1] ?? "";
    expect(block).toContain("github.event_name == 'push'");
    expect(block).toContain("github.ref == 'refs/heads/main'");
    expect(block).toContain("needs.quality-gate.result == 'success'");
  });

  it("never publishes from a manual diagnostic run", () => {
    // `workflow_dispatch` exists so an operator can run the checks by hand.
    // The ref condition on publication means a dispatch can never publish,
    // which is what makes the diagnostic safe to offer at all.
    expect(ci).toContain("workflow_dispatch:");
    const block = /\n {2}publish-commit-images:\n([\s\S]*?)$/.exec(ci)?.[1] ?? "";
    expect(block).toContain("github.event_name == 'push'");
  });
});

describe("what triggers a gate at all", () => {
  it("runs on pull requests and on pushes to main, and no other branch", () => {
    // A push to a work branch with no pull request runs no required gate and
    // builds nothing. That is deliberate: the gate exists to guard what merges
    // and what publishes, not to watch someone's scratch branch.
    const triggers = /\non:\n([\s\S]*?)\npermissions:/.exec(ci)?.[1] ?? "";
    expect(triggers).toMatch(/push:\n {4}branches: \[main\]/);
    expect(triggers).toContain("pull_request:");
  });

  it("exposes itself to release.yml by workflow_call", () => {
    const triggers = /\non:\n([\s\S]*?)\npermissions:/.exec(ci)?.[1] ?? "";
    expect(triggers).toContain("workflow_call:");
  });

  it("exports the candidate SHA so a caller can detect stale evidence", () => {
    // The whole anti-staleness mechanism: a release compares this against its
    // own `github.sha`, so gate evidence from another commit is detectable
    // rather than assumed fresh.
    expect(ci).toMatch(/candidate_sha:/);
    // Matched as a pattern rather than as a literal: the literal contains a
    // GitHub Actions expression, which reads to a JavaScript linter as an
    // unintended template placeholder.
    expect(ci).toMatch(/value: \$\{\{ jobs\.quality-gate\.outputs\.candidate_sha \}\}/);
  });
});
