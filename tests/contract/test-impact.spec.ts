import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config.js";
import { commandsForVitestGroup } from "../../scripts/ci/run-affected-vitest.js";
import {
  createImpactPlan,
  loadImpactPolicy,
  parseNameStatusDiff,
  renderImpactSummary,
  validateImpactPolicy,
} from "../../scripts/ci/test-impact.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const policy = loadImpactPolicy(repoRoot);
const impactSchema = JSON.parse(
  readFileSync(
    path.join(repoRoot, "specs/016-ci-cache-selective-tests/contracts/impact-plan.schema.json"),
    "utf8",
  ),
) as object;
const validatePlanSchema = new Ajv2020({ strict: true }).compile(impactSchema);

function pullRequestPlan(
  changedPaths: string[],
  baseSha: string | null = "base",
  deletedPaths: string[] = [],
) {
  return createImpactPlan(policy, {
    event: "pull_request",
    ref: "refs/pull/42/merge",
    baseSha,
    headSha: "head",
    pullRequestNumber: "42",
    changedPaths,
    deletedPaths,
  });
}

describe("impact policy", () => {
  it("is complete and internally valid", () => {
    expect(validateImpactPolicy(policy, repoRoot)).toEqual([]);
  });

  it("declares every maintained E2E journey exactly once", () => {
    const actual = readdirSync(path.join(repoRoot, "tests/e2e"))
      .filter((file) => file.endsWith(".spec.ts"))
      .map((file) => `tests/e2e/${file}`)
      .sort();
    const declared = policy.e2eJourneys.map(({ test }) => test).sort();
    expect(declared).toEqual(actual);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("rejects an impact policy that omits a maintained E2E journey", () => {
    const incomplete = structuredClone(policy);
    incomplete.e2eJourneys.pop();
    expect(validateImpactPolicy(incomplete, repoRoot)).toContain(
      "e2eJourneys must declare every tests/e2e/*.spec.ts file exactly once",
    );
  });

  it("keeps the E2E matrix aligned with Playwright projects", () => {
    expect(policy.e2eProjects).toEqual(playwrightConfig.projects?.map(({ name }) => name));
  });

  it.each([
    ["none", ["README.md"]],
    ["related", ["packages/domain/src/document/block.ts"]],
    ["direct", ["apps/web/tests/sidebar.spec.ts"]],
    ["full", ["pnpm-lock.yaml"]],
  ])("validates a generated %s plan against the versioned schema", (_name, changedPaths) => {
    const valid = validatePlanSchema(pullRequestPlan(changedPaths));
    expect(validatePlanSchema.errors).toEqual(null);
    expect(valid).toBe(true);
  });

  it("rejects a plan outside the versioned schema", () => {
    const invalid = { ...pullRequestPlan(["README.md"]), mode: "optimistic" };
    expect(validatePlanSchema(invalid)).toBe(false);
  });
});

describe("change-set parsing", () => {
  it("retains both sides of a rename", () => {
    expect(parseNameStatusDiff("R100\0old/path.ts\0new/path.ts\0M\0README.md\0")).toEqual({
      changedPaths: ["README.md", "new/path.ts", "old/path.ts"],
      deletedPaths: ["old/path.ts"],
    });
  });

  it("distinguishes deletions from copies", () => {
    expect(parseNameStatusDiff("D\0removed.ts\0C100\0source.ts\0copy.ts\0A\0added.ts\0")).toEqual({
      changedPaths: ["added.ts", "copy.ts", "removed.ts", "source.ts"],
      deletedPaths: ["removed.ts"],
    });
  });
});

describe("pull-request selection", () => {
  it("uses an explicit no-op for documentation-only changes", () => {
    const plan = pullRequestPlan(["README.md", "docs/development.md"]);
    expect(plan.mode).toBe("none");
    expect(plan.vitest).toEqual({ mode: "none", sourceFiles: [], testFiles: [], groups: [] });
    expect(plan.e2e.matrix).toEqual([{ project: "none" }]);
  });

  it("uses Vitest relationships and explicit E2E owners for narrow source changes", () => {
    const plan = pullRequestPlan(["packages/domain/src/document/block.ts"]);
    expect(plan.mode).toBe("affected");
    expect(plan.vitest.mode).toBe("related");
    expect(plan.vitest.sourceFiles).toEqual(["packages/domain/src/document/block.ts"]);
    expect(plan.e2e.testFiles).toEqual(
      expect.arrayContaining([
        "tests/e2e/block-editor.spec.ts",
        "tests/e2e/editor-performance.spec.ts",
        "tests/e2e/page-links.spec.ts",
      ]),
    );
  });

  it("maps the shared search surface to online, offline and accessibility journeys", () => {
    const plan = pullRequestPlan(["apps/web/src/features/search/search-dialog.tsx"]);
    expect(plan.e2e.testFiles).toEqual(
      expect.arrayContaining([
        "tests/e2e/accessibility.spec.ts",
        "tests/e2e/search.spec.ts",
        "tests/e2e/search-offline.spec.ts",
      ]),
    );
  });

  it("keeps the search performance corpus attached to every indexed source change", () => {
    const plan = pullRequestPlan(["packages/domain/src/search/search-index.ts"]);

    expect(plan.vitest.mode).toBe("mixed");
    expect(plan.vitest.testFiles).toContain("tests/performance/search.perf.spec.ts");
    expect(plan.vitest.groups).toContain("performance");
    expect(plan.e2e.testFiles).toEqual(
      expect.arrayContaining(["tests/e2e/search.spec.ts", "tests/e2e/search-offline.spec.ts"]),
    );
    expect(commandsForVitestGroup(plan, "performance")).toContainEqual([
      "pnpm",
      ["exec", "vitest", "run", "--passWithNoTests", "tests/performance/search.perf.spec.ts"],
    ]);
  });

  it("always runs a changed test directly", () => {
    const plan = pullRequestPlan(["apps/web/tests/sidebar.spec.ts"]);
    expect(plan.vitest.mode).toBe("direct");
    expect(plan.vitest.testFiles).toEqual(["apps/web/tests/sidebar.spec.ts"]);
    expect(plan.vitest.groups).toEqual(["unit"]);
  });

  it("keeps a changed performance benchmark in the dedicated group", () => {
    const plan = pullRequestPlan(["tests/performance/databases.perf.spec.ts"]);
    expect(plan.vitest.mode).toBe("direct");
    expect(plan.vitest.groups).toEqual(["performance"]);
    expect(commandsForVitestGroup(plan, "performance")).toEqual([
      [
        "pnpm",
        ["exec", "vitest", "run", "--passWithNoTests", "tests/performance/databases.perf.spec.ts"],
      ],
    ]);
    expect(commandsForVitestGroup(plan, "unit")).toEqual([]);
  });

  it("maps test-consumed documents to their direct contract tests", () => {
    const plan = pullRequestPlan([
      "specs/002-owner-security-foundation/contracts/security-api.openapi.yaml",
    ]);
    expect(plan.vitest.mode).toBe("direct");
    expect(plan.vitest.testFiles).toEqual([
      "tests/contract/admin-cli.contract.spec.ts",
      "tests/contract/security-api.spec.ts",
    ]);
    expect(plan.e2e.mode).toBe("none");
  });

  it.each(["pnpm-lock.yaml", "unknown-runtime.config.ts"])(
    "fails closed for broad or unknown input %s",
    (changedPath) => {
      const plan = pullRequestPlan([changedPath]);
      expect(plan.mode).toBe("full");
      expect(plan.vitest.mode).toBe("full");
      expect(plan.e2e.mode).toBe("full");
    },
  );

  it("runs every E2E journey when the shared application shell changes", () => {
    const plan = pullRequestPlan(["apps/web/src/app.tsx"]);
    expect(plan.e2e.mode).toBe("full");
    expect(plan.e2e.testFiles).toHaveLength(policy.e2eJourneys.length);
  });

  it("fails closed when a deleted source no longer has a Vitest graph", () => {
    const deleted = "packages/domain/src/document/block.ts";
    const plan = pullRequestPlan([deleted], "base", [deleted]);
    expect(plan.vitest.mode).toBe("full");
    expect(plan.deletedPaths).toEqual([deleted]);
    expect(plan.reasons.join(" ")).toContain("deleted");
  });

  it("fails closed when the comparison base is unavailable", () => {
    const plan = pullRequestPlan(["README.md"], null);
    expect(plan.mode).toBe("full");
    expect(plan.reasons.join(" ")).toContain("base");
  });

  it("is deterministic regardless of input order and duplicates", () => {
    const first = pullRequestPlan([
      "apps/web/src/features/editor/editor-view.tsx",
      "README.md",
      "apps/web/src/features/editor/editor-view.tsx",
    ]);
    const second = pullRequestPlan(["README.md", "apps/web/src/features/editor/editor-view.tsx"]);
    expect(first).toEqual(second);
  });
});

describe("trusted and diagnostic execution", () => {
  it.each([
    ["push", "refs/heads/main", "main"],
    ["push", "refs/tags/v1.2.3", "release-head"],
    ["workflow_dispatch", "refs/heads/topic", "diagnostic-head"],
  ])("uses a full plan and isolated cache scope for %s %s", (event, ref, cacheScope) => {
    const plan = createImpactPlan(policy, {
      event,
      ref,
      baseSha: null,
      headSha: "head",
      pullRequestNumber: null,
      changedPaths: ["README.md"],
      deletedPaths: [],
    });
    expect(plan.mode).toBe("full");
    expect(plan.cacheScope).toBe(cacheScope);
  });
});

describe("plan consumers", () => {
  it("produces no command for an empty group", () => {
    expect(commandsForVitestGroup(pullRequestPlan(["README.md"]), "unit")).toEqual([]);
    expect(commandsForVitestGroup(pullRequestPlan(["README.md"]), "performance")).toEqual([]);
  });

  it("preserves the existing complete commands for a full plan", () => {
    const plan = pullRequestPlan(["pnpm-lock.yaml"]);
    expect(commandsForVitestGroup(plan, "unit")).toEqual([["pnpm", ["test:coverage"]]]);
    expect(commandsForVitestGroup(plan, "performance")).toEqual([["pnpm", ["test:performance"]]]);
    expect(commandsForVitestGroup(plan, "integration")).toEqual([
      ["pnpm", ["test:integration"]],
      ["pnpm", ["db:test-migrations"]],
    ]);
    expect(commandsForVitestGroup(plan, "contract")).toEqual([["pnpm", ["test:contract"]]]);
  });

  it("turns an affected source into a project-scoped Vitest related command", () => {
    const plan = pullRequestPlan(["packages/domain/src/document/block.ts"]);
    const commands = commandsForVitestGroup(plan, "unit");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.[0]).toBe("pnpm");
    expect(commands[0]?.[1]).toEqual(
      expect.arrayContaining([
        "related",
        "--run",
        "--project",
        "domain",
        "packages/domain/src/document/block.ts",
      ]),
    );
    expect(commandsForVitestGroup(plan, "performance")).toEqual([
      [
        "pnpm",
        [
          "exec",
          "vitest",
          "related",
          "--run",
          "--passWithNoTests",
          "--project",
          "performance",
          "packages/domain/src/document/block.ts",
        ],
      ],
    ]);
  });

  it("runs a changed Vitest file directly", () => {
    expect(
      commandsForVitestGroup(pullRequestPlan(["apps/web/tests/sidebar.spec.ts"]), "unit"),
    ).toEqual([
      ["pnpm", ["exec", "vitest", "run", "--passWithNoTests", "apps/web/tests/sidebar.spec.ts"]],
    ]);
  });

  it("renders the same selection and reasons as the machine-readable plan", () => {
    const plan = pullRequestPlan(["apps/web/src/features/editor/editor-view.tsx"]);
    const summary = renderImpactSummary(plan);
    expect(summary).toContain(plan.changedPaths[0] ?? "missing");
    expect(summary).toContain(plan.mode);
    expect(summary).toContain(plan.cacheScope);
    for (const testFile of plan.e2e.testFiles) {
      expect(summary).toContain(testFile);
    }
  });
});
