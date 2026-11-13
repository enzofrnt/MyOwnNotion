/**
 * Timing rules of the browser gate (feature 058).
 *
 * `test.slow()` multiplies the *project* budget, so the same marker meant 180
 * seconds on Chromium and 360 on WebKit, and a broken journey waited that long
 * before saying so. Journeys that need more than the default state an explicit
 * budget instead, which is the same number on every engine and is reviewable.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const journeyRoot = path.join(repoRoot, "tests", "e2e");

function journeySources(): Array<{ file: string; source: string }> {
  return readdirSync(journeyRoot)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, source: readFileSync(path.join(journeyRoot, file), "utf8") }));
}

describe("browser gate timing rules", () => {
  it("never scales a journey budget with test.slow()", () => {
    const offenders = journeySources()
      .filter(({ source }) => /\btest\.slow\s*\(/u.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps every explicit journey budget within three minutes", () => {
    const offenders: string[] = [];
    for (const { file, source } of journeySources()) {
      for (const match of source.matchAll(/\btest\.setTimeout\(\s*([\d_]+)\s*\)/gu)) {
        const budget = Number((match[1] ?? "").replaceAll("_", ""));
        if (!Number.isFinite(budget) || budget > 180_000) offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
