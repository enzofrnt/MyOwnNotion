import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NOTION_IMPORT_HELP, runNotionImportCli } from "../src/imports/notion/cli.ts";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "notion-cli-"));
});
afterAll(async () => {
  await rm(root, { force: true, recursive: true });
});
describe("Notion CLI argument and report boundaries", () => {
  it.each([[], ["--help"]].map((argv) => ({ argv })))(
    "prints setup guidance without accessing a source or target",
    async ({ argv }) => {
      const lines: string[] = [];
      expect(await runNotionImportCli(argv, (line) => lines.push(line))).toBe(0);
      expect(lines).toEqual([NOTION_IMPORT_HELP]);
    },
  );
  it.each(
    [
      ["--unknown"],
      ["--source"],
      ["--source", "--json"],
      ["--json", "--json"],
      [""],
      ["--apply"],
      ["--source", ".", "--id", "bad-private-identifier"],
    ].map((argv) => ({ argv })),
  )("refuses malformed input without printing values", async ({ argv }) => {
    const lines: string[] = [];
    expect(await runNotionImportCli(argv, (line) => lines.push(line), {})).toBe(2);
    expect(lines).toEqual(["import.invalid-arguments"]);
  });
  it("reports an empty source, safe JSON failures and conversion notices without target settings", async () => {
    const lines: string[] = [];
    expect(await runNotionImportCli(["--source", root], (line) => lines.push(line), {})).toBe(0);
    expect(lines.at(-1)).toContain("0 pages, 0 sources");
    await writeFile(join(root, "Page.md"), "# Private title\n<div>Private HTML</div>");
    expect(await runNotionImportCli(["--source", root], (line) => lines.push(line), {})).toBe(0);
    expect(lines.at(-1)).toContain("1 conversion notices (0 blocking)");
    expect(lines.at(-1)).not.toContain("Private");
    expect(
      await runNotionImportCli(
        ["--source", root, "--id", "invalid", "--json"],
        (line) => lines.push(line),
        {},
      ),
    ).toBe(2);
    expect(JSON.parse(lines.at(-1) ?? "{}")).toEqual({ code: "import.invalid-arguments" });
    expect(
      await runNotionImportCli(
        ["--source", join(root, "missing-private-source"), "--json"],
        (line) => lines.push(line),
        {},
      ),
    ).toBe(1);
    expect(JSON.parse(lines.at(-1) ?? "{}")).toEqual({ code: "import.unavailable" });
  });
});
