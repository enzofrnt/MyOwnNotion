import { describe, expect, it } from "vitest";
import { NotionApiClient } from "../src/imports/notion/api-client.ts";
import { runNotionImportCli } from "../src/imports/notion/cli.ts";

describe("Notion API CLI", () => {
  it("previews without target access even when dry-run accompanies apply", async () => {
    const page = {
      object: "page",
      id: "00000000-0000-4000-8000-000000000001",
      properties: {},
      title: [{ plain_text: "private preview title" }],
      parent: { type: "workspace", workspace: true },
      last_edited_time: "stable",
    };
    const lines: string[] = [];
    const client = () =>
      new NotionApiClient("fixture-preview", {
        sleep: async () => {},
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          if (path === "/v1/search" || path.endsWith("/children"))
            return Response.json({
              object: "list",
              results: path === "/v1/search" ? [page] : [],
              has_more: false,
              next_cursor: null,
            });
          return Response.json(page);
        },
      });
    expect(
      await runNotionImportCli(
        ["--all", "--apply", "--dry-run"],
        (line) => lines.push(line),
        { NOTION_TOKEN: "fixture-secret", DATABASE_URL: "unavailable" },
        { client },
      ),
    ).toBe(0);
    expect(lines[0]).toContain("1 pages");
    expect(lines.join()).not.toContain("private preview title");
    expect(lines.join()).not.toContain("fixture-secret");
  });
  it("removes file import and refuses ambiguous selection/missing credentials", async () => {
    for (const args of [
      ["--source", "private.zip"],
      ["--all", "--apply"],
      ["--resume"],
      ["--all", "--discover"],
      ["--all", "--exclude-database", "invalid"],
      ["--discover", "--exclude-database", "00000000-0000-4000-8000-000000000001"],
      [
        "--resume",
        "--id",
        "00000000-0000-4000-8000-000000000001",
        "--exclude-database",
        "00000000-0000-4000-8000-000000000002",
      ],
    ]) {
      const lines: string[] = [];
      expect(await runNotionImportCli(args, (line) => lines.push(line), {})).toBe(2);
      expect(lines).toEqual(["import.invalid-arguments"]);
    }
    const lines: string[] = [];
    expect(await runNotionImportCli(["--all"], (line) => lines.push(line), {})).toBe(1);
    expect(lines).toEqual(["import.token-required"]);
  });
  it("discovers without opening a target and emits only counts unless json is requested", async () => {
    const lines: string[] = [];
    const client = () =>
      new NotionApiClient("fixture-cli", {
        sleep: async () => {},
        fetch: async () =>
          Response.json({
            object: "list",
            results: [
              {
                object: "page",
                id: "00000000-0000-4000-8000-000000000001",
                title: [{ plain_text: "private fixture title" }],
                parent: { type: "workspace", workspace: true },
              },
            ],
            has_more: false,
            next_cursor: null,
          }),
      });
    expect(
      await runNotionImportCli(
        ["--discover"],
        (line) => lines.push(line),
        { NOTION_TOKEN: "fixture-secret", DATABASE_URL: "unavailable" },
        { client },
      ),
    ).toBe(0);
    expect(lines[0]).toContain("1 accessible objects");
    expect(lines.join()).not.toContain("private fixture title");
    expect(lines.join()).not.toContain("fixture-secret");
  });
});
