import { generateUuidV7 } from "@myownnotion/domain";
import type { Editor, Range } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { filterWikiLinkCandidates, insertWikiLink } from "./wiki-link.ts";

describe("wiki-link page picker", () => {
  it("filters locally, excludes the source, sorts deterministically, and bounds results", () => {
    const sourceItemId = generateUuidV7();
    const candidates = [
      { id: generateUuidV7(), name: "Zulu notes" },
      { id: sourceItemId, name: "Alpha source" },
      { id: generateUuidV7(), name: "Beta page" },
    ];
    expect(
      filterWikiLinkCandidates(candidates, "page", sourceItemId).map((item) => item.name),
    ).toEqual(["Beta page"]);
    expect(filterWikiLinkCandidates(candidates, "missing", sourceItemId)).toEqual([]);
    expect(filterWikiLinkCandidates(candidates, "", sourceItemId).map((item) => item.name)).toEqual(
      ["Beta page", "Zulu notes"],
    );
  });

  it("deletes the query and inserts stable marked text followed by editable space", () => {
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
    const range: Range = { from: 3, to: 9 };
    const candidate = { id: generateUuidV7(), name: "Target page" };
    const occurrenceId = generateUuidV7();

    expect(insertWikiLink(editor, range, candidate, occurrenceId)).toBe(true);
    expect(calls.slice(0, 3)).toEqual([
      { name: "focus", args: [] },
      { name: "deleteRange", args: [range] },
      {
        name: "insertContent",
        args: [
          [
            {
              type: "text",
              text: "Target page",
              marks: [{ type: "wikiLink", attrs: { targetItemId: candidate.id, occurrenceId } }],
            },
            { type: "text", text: " " },
          ],
        ],
      },
    ]);
    expect(calls.at(-1)?.name).toBe("run");
  });
});
