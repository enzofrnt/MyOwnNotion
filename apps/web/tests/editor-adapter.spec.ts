import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import type { EditorBlock, EditorBlocksChanged } from "../src/features/editor/blocknote-schema.ts";
import {
  commandsFromBlockNoteChanges,
  minimalTextReplacement,
} from "../src/features/editor/editor-adapter.ts";

const FIRST = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as Uuid;
const SECOND = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2057" as Uuid;

function paragraph(id: Uuid, text: string): EditorBlock {
  return {
    id,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: text === "" ? [] : [{ type: "text", text, styles: {} }],
    children: [],
  } as EditorBlock;
}

describe("BlockNote changes → page commands", () => {
  it("emits the bounded text replacement instead of replacing the block", () => {
    const before = paragraph(FIRST, "alpha");
    const after = paragraph(FIRST, "alpine");
    const changes = [
      { type: "update", block: after, prevBlock: before, source: { type: "local" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [after] })).toEqual([
      { type: "replace-text", blockId: FIRST, from: 3, to: 5, text: "ine" },
    ]);
  });

  it("keeps a move as one move command, never delete plus insert", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const changes = [
      {
        type: "move",
        block: second,
        prevBlock: second,
        source: { type: "drop" },
      },
    ] as EditorBlocksChanged;

    const commands = commandsFromBlockNoteChanges({ changes, document: [second, first] });

    expect(commands).toEqual([
      { type: "move-block", blockId: SECOND, parentBlockId: null, beforeBlockId: FIRST },
    ]);
    expect(commands.map((command) => command.type)).not.toContain("delete-block");
    expect(commands.map((command) => command.type)).not.toContain("insert-block");
  });

  it("uses the final sibling order for a multi-block paste in one atomic command batch", () => {
    const first = paragraph(FIRST, "first");
    const second = paragraph(SECOND, "second");
    const changes = [
      { type: "insert", block: first, prevBlock: undefined, source: { type: "paste" } },
      { type: "insert", block: second, prevBlock: undefined, source: { type: "paste" } },
    ] as EditorBlocksChanged;

    const commands = commandsFromBlockNoteChanges({ changes, document: [first, second] });

    expect(commands).toHaveLength(2);
    expect(commands).toEqual([
      expect.objectContaining({
        type: "insert-block",
        block: expect.objectContaining({ id: SECOND }),
      }),
      expect.objectContaining({
        type: "insert-block",
        block: expect.objectContaining({ id: FIRST }),
        beforeBlockId: SECOND,
      }),
    ]);
  });
});

describe("minimal UTF-16 text diff", () => {
  it("keeps the common prefix and suffix", () => {
    expect(minimalTextReplacement("un ancien texte", "un nouveau texte")).toEqual({
      from: 3,
      to: 9,
      text: "nouveau",
    });
  });
});
