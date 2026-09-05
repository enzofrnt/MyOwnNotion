/**
 * What a published image must be (T094, T103, US6, FR-032, FR-034, SC-007).
 *
 * Two properties, and both are about a question an operator asks while
 * something is on fire: **what is running, and what do I go back to?**
 *
 * **Every tag is immutable.** A commit SHA or an exact version, and no
 * `latest`. A moving tag means a deployment cannot name what it is running and
 * a rollback cannot name what to return to — the two moments the tag exists
 * for are exactly the two it fails at.
 *
 * **Publication cannot happen on stale evidence.** The release calls the gate
 * rather than reacting to it, and compares the SHA the gate reports against
 * its own. A `workflow_run` trigger fires after some earlier run finished, and
 * the run it reports on may be for a different commit; that is the classic way
 * a release goes out verified by something else.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workflows = path.join(repoRoot, ".github", "workflows");
const release = readFileSync(path.join(workflows, "release.yml"), "utf8");
const ci = readFileSync(path.join(workflows, "ci.yml"), "utf8");
const gha = (expression: string): string => `\${{ ${expression} }}`;
const ruleset = JSON.parse(
  readFileSync(path.join(repoRoot, ".github", "rulesets", "main.json"), "utf8"),
) as {
  rules: { type: string; parameters?: Record<string, unknown> }[];
  bypass_actors: unknown[];
};

describe("what triggers a release", () => {
  it("is a strict version tag and nothing else", () => {
    // Anchored at both ends. A loose pattern matches `v1.2.3-rc1`, and a
    // release candidate published to the same immutable channel as a release
    // is a release nobody meant to make.
    // The pattern line itself, wherever it sits under `tags:` — there is a
    // comment between them explaining why it is anchored.
    //
    // The dots are literal, not escaped: a tag filter is a glob, not a regular
    // expression, and GitHub anchors it implicitly. `v1.2.3-rc1` therefore
    // does not match, because the trailing `-rc1` has nothing to match
    // against.
    expect(release).toMatch(/^ +- "v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+"$/m);
  });

  it("has no branch trigger", () => {
    // `ci.yml` already publishes a commit image for every commit on `main`. A
    // second path publishing the same commit under a different name would be
    // two answers to "what is running".
    const triggers = /\non:\n([\s\S]*?)\npermissions:/.exec(release)?.[1] ?? "";
    expect(triggers).not.toMatch(/branches:/);
  });

  it("never reacts to another workflow finishing", () => {
    // The whole anti-staleness structure. `workflow_run` reports on a run that
    // may be for a different commit.
    //
    // Matched as a trigger rather than as a word: both files explain in prose
    // why they do not use it, and counting those mentions would make this test
    // fail for the files saying the right thing.
    for (const [name, workflow] of [
      ["release.yml", release],
      ["ci.yml", ci],
    ] as const) {
      expect(workflow, `${name} reacts to another workflow`).not.toMatch(/^ {2}workflow_run:/m);
    }
  });
});

describe("the gate a release depends on", () => {
  it("is the same one every pull request runs", () => {
    // A release verified by a weaker gate is a release verified by a different
    // gate. Calling the reusable workflow means there is one definition.
    expect(release).toContain("uses: ./.github/workflows/ci.yml");
  });

  it("is compared against this release's own commit", () => {
    expect(release).toMatch(/needs\.quality-gate\.outputs\.candidate_sha/);
    expect(release).toMatch(/GATE_SHA" != "\$RELEASE_SHA/);
  });

  it("refuses an empty candidate as well as a mismatched one", () => {
    // An absent value is not a matching value. Treating it as one would let a
    // gate that exported nothing pass the freshness check.
    expect(release).toMatch(/if \[ -z "\$GATE_SHA" \]/);
  });

  it("requires both the gate's success and the freshness check", () => {
    // Freshness alone says nothing about whether the gate passed; success
    // alone says nothing about which commit it ran on.
    expect(release).toContain("needs.quality-gate.result == 'success'");
    expect(release).toContain("needs.verify-candidate.result == 'success'");
  });
});

describe("what gets published", () => {
  it("carries an immutable version tag and an immutable commit tag", () => {
    expect(release).toContain(
      `${gha("steps.release-meta.outputs.registry")}-api:${gha("steps.release-meta.outputs.version")}`,
    );
    expect(release).toContain(
      `${gha("steps.release-meta.outputs.registry")}-web:${gha("steps.release-meta.outputs.version")}`,
    );
    expect(release).toContain(
      `${gha("steps.release-meta.outputs.registry")}-api:sha-${gha("github.sha")}`,
    );
    expect(release).toContain(
      `${gha("steps.release-meta.outputs.registry")}-web:sha-${gha("github.sha")}`,
    );
  });

  it("embeds the immutable commit identity in the API runtime", () => {
    const apiBuild = /file: docker\/api\.Dockerfile([\s\S]*?)\n +tags:/.exec(release)?.[1] ?? "";
    expect(apiBuild).toContain(`APPLICATION_VERSION=sha-${gha("github.sha")}`);
  });

  it("publishes no moving tag", () => {
    // Asserted across both workflows, because one `latest` anywhere is enough
    // to make every deployment ambiguous.
    for (const [name, workflow] of [
      ["release.yml", release],
      ["ci.yml", ci],
    ] as const) {
      expect(workflow, `${name} publishes a moving tag`).not.toMatch(/:latest"/);
    }
  });

  it("builds both architectures from the pinned platform list", () => {
    // Read from `docker/base-images.json` rather than written here, so the
    // published set cannot drift from the one the local build check enforces.
    expect(release).toMatch(/platforms=\$\(jq -r '\.platforms \| join\(","\)'/);
    const bases = JSON.parse(
      readFileSync(path.join(repoRoot, "docker", "base-images.json"), "utf8"),
    ) as { platforms: string[] };
    expect(bases.platforms).toContain("linux/amd64");
    expect(bases.platforms).toContain("linux/arm64");
  });

  it("builds from pinned base digests", () => {
    // A base referenced by tag would make two builds of the same commit
    // produce different images, which defeats the point of an immutable tag.
    expect(release).toMatch(/\.bases\.bun \| "\\\(\.ref\)@\\\(\.digest\)"/);
  });

  it("attaches provenance and an SBOM", () => {
    expect(release).toContain("provenance: true");
    expect(release).toContain("sbom: true");
  });

  it("records the digests it published", () => {
    // The evidence a rollback needs: what was pushed, for which commit, on
    // which platforms. A tag can be argued about; a digest cannot.
    expect(release).toContain("released-images.json");
    expect(release).toContain("steps.release-api.outputs.digest");
    expect(release).toContain("steps.release-web.outputs.digest");
    expect(release).toContain("if-no-files-found: error");
  });

  it("links the package to this repository", () => {
    // Without `org.opencontainers.image.source` GHCR keeps the package
    // unattached: no Packages tab, no visible provenance. On the index as well
    // as the config, because a multi-architecture push publishes a manifest
    // list and GHCR reads the link from the index.
    expect(release).toContain(
      `org.opencontainers.image.source=${gha("steps.release-meta.outputs.source_url")}`,
    );
    expect(release).toContain(
      `index:org.opencontainers.image.source=${gha("steps.release-meta.outputs.source_url")}`,
    );
  });

  it("reuses only exact-release trusted cache scopes", () => {
    expect(release).toContain(`cache-from: type=gha,scope=api-release-${gha("github.sha")}`);
    expect(release).toContain(`cache-from: type=gha,scope=web-release-${gha("github.sha")}`);
    expect(release).toContain(`cache-to: type=gha,mode=max,scope=api-release-${gha("github.sha")}`);
    expect(release).toContain(`cache-to: type=gha,mode=max,scope=web-release-${gha("github.sha")}`);
    expect(release).not.toContain("scope=api-pr-");
    expect(release).not.toContain("scope=web-pr-");
  });

  it("keeps publication independent from cache export availability", () => {
    const exports = [...release.matchAll(/^ +cache-to: (.+)$/gm)].map((match) => match[1] ?? "");
    expect(exports).toHaveLength(2);
    expect(exports.every((entry) => entry.includes("ignore-error=true"))).toBe(true);
  });
});

describe("who may publish a release", () => {
  it("permits only the reusable CI invocation and the gated publisher to request package writes", () => {
    const grants = [...release.matchAll(/^ +packages: write$/gm)];
    expect(grants).toHaveLength(2);
    expect(release).toMatch(
      /quality-gate:[\s\S]*?uses: \.\/\.github\/workflows\/ci\.yml[\s\S]*?packages: write/,
    );
  });

  it("keeps the workflow's own permissions read-only", () => {
    expect(release).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});

describe("the protected branch", () => {
  it("requires the single aggregate check", () => {
    const checks = ruleset.rules.find((rule) => rule.type === "required_status_checks");
    expect(JSON.stringify(checks?.parameters)).toContain("quality-gate");
  });

  it("refuses a check that ran on an older commit", () => {
    // `strict_required_status_checks_policy` is what makes a stale green check
    // insufficient: the branch must be up to date, so the check that passed is
    // a check on what will actually land.
    const checks = ruleset.rules.find((rule) => rule.type === "required_status_checks");
    expect(checks?.parameters?.["strict_required_status_checks_policy"]).toBe(true);
  });

  it("has no bypass actors", () => {
    // A bypass list is a list of ways the gate does not apply. There is a
    // deliberate exception in practice — an owner merging with `--admin` — and
    // it is visible in the audit log rather than pre-authorised here.
    expect(ruleset.bypass_actors).toHaveLength(0);
  });

  it("forbids deletion and non-fast-forward pushes", () => {
    const types = ruleset.rules.map((rule) => rule.type);
    expect(types).toContain("deletion");
    expect(types).toContain("non_fast_forward");
  });
});
