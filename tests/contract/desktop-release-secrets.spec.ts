/**
 * Signing and publication secrets never enter the repository (feature 014, T057).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const SECRET_NAMES = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_IDENTITY",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
] as const;

describe("desktop release secrets", () => {
  it("references signing material only through GitHub secrets", () => {
    const workflow = read(".github/workflows/desktop-release.yml");
    for (const name of SECRET_NAMES) {
      expect(workflow, name).toContain(`secrets.${name}`);
      expect(workflow).not.toMatch(new RegExp(`${name}:\\s*['"](?!\\$\\{\\{)`));
    }
    expect(workflow).toContain("secrets.GITHUB_TOKEN");
    expect(workflow).not.toMatch(/BEGIN (CERTIFICATE|PRIVATE KEY)/);
    expect(workflow).not.toMatch(/-----BEGIN/);
  });

  it("does not scan or package secret fixtures from the desktop smoke tree", () => {
    const fixtures = read("scripts/desktop/fixtures/README.md");
    expect(fixtures.toLowerCase()).toContain("never");
    const smoke = read("scripts/desktop/run-installed-smoke.ts");
    expect(smoke).not.toMatch(/CSC_|APPLE_API_|BEGIN CERTIFICATE/);
    const ci = read(".github/workflows/desktop-ci.yml");
    expect(ci).not.toContain("secrets.CSC_LINK");
    expect(ci).toContain("bun run security:secrets");
  });
});
