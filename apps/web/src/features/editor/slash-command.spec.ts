import type { Editor, Range } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { executeSlashCommand, filterSlashCommands, SLASH_COMMANDS } from "./slash-command.ts";

describe("slash command catalogue", () => {
  it("lists every supported block and filters labels, descriptions, and keywords", () => {
    expect(SLASH_COMMANDS.map((command) => command.id)).toEqual([
      "paragraph",
      "heading-1",
      "heading-2",
      "heading-3",
      "bullet-list",
      "ordered-list",
      "task-list",
      "canvas",
      "database",
      "blockquote",
      "code-block",
      "divider",
    ]);
    expect(filterSlashCommands("task").map((command) => command.id)).toEqual(["task-list"]);
    expect(filterSlashCommands("gallery").map((command) => command.id)).toEqual(["database"]);
    expect(filterSlashCommands("whiteboard").map((command) => command.id)).toEqual(["canvas"]);
    expect(filterSlashCommands("number").map((command) => command.id)).toEqual(["ordered-list"]);
    expect(filterSlashCommands("quotation").map((command) => command.id)).toEqual(["blockquote"]);
    expect(filterSlashCommands("no-such-block")).toEqual([]);
  });

  it("removes the query and executes each local editor command", () => {
    const calls: Array<{ readonly name: string; readonly args: unknown[] }> = [];
    let chain: Record<string, unknown>;
    chain = new Proxy(
      {},
      {
        get:
          (_target, property) =>
          (...args: unknown[]) => {
            calls.push({ name: String(property), args });
            return property === "run" ? true : chain;
          },
      },
    );
    const editor = { chain: () => chain } as unknown as Editor;
    const range: Range = { from: 4, to: 9 };

    for (const command of SLASH_COMMANDS) {
      calls.length = 0;
      expect(executeSlashCommand(editor, range, command.id)).toBe(true);
      expect(calls.slice(0, 2)).toEqual([
        { name: "focus", args: [] },
        { name: "deleteRange", args: [range] },
      ]);
      expect(calls.at(-1)?.name).toBe("run");
    }
    expect(executeSlashCommand(editor, range, "unknown")).toBe(false);
  });
});
