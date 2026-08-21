import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import type { EditorBlock, EditorBlocksChanged } from "../src/features/editor/blocknote-schema.ts";
import {
  commandsFromBlockNoteChanges,
  EditorChangeBatcher,
  minimalTextReplacement,
} from "../src/features/editor/editor-adapter.ts";

const BLOCK_ID = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as Uuid;

function paragraph(text: string): EditorBlock {
  return {
    id: BLOCK_ID,
    type: "paragraph",
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  } as EditorBlock;
}

describe("editor input boundaries", () => {
  it("never splits an emoji surrogate pair when computing a replacement", () => {
    expect(minimalTextReplacement("A 👋 B", "A 👋 joli B")).toEqual({
      from: 5,
      to: 5,
      text: "joli ",
    });
    expect(minimalTextReplacement("🧑‍💻", "🧑‍💻 !")).toEqual({
      from: 5,
      to: 5,
      text: " !",
    });
  });

  it("keeps accents and pasted Unicode in one bounded command", () => {
    const before = paragraph("eleve");
    const after = paragraph("élève — 東京");
    const changes = [
      { type: "update", block: after, prevBlock: before, source: { type: "paste" } },
    ] as EditorBlocksChanged;

    expect(commandsFromBlockNoteChanges({ changes, document: [after] })).toEqual([
      { type: "replace-text", blockId: BLOCK_ID, from: 0, to: 5, text: "élève — 東京" },
    ]);
  });

  it("publishes a whole IME composition as one transaction batch", () => {
    const batches: EditorBlocksChanged[] = [];
    const batcher = new EditorChangeBatcher((batch) => batches.push(batch));
    const first = paragraph("に");
    const second = paragraph("日本");

    batcher.beginComposition();
    batcher.push([
      { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
    ] as EditorBlocksChanged);
    batcher.push([
      { type: "update", block: second, prevBlock: first, source: { type: "local" } },
    ] as EditorBlocksChanged);
    expect(batches).toEqual([]);

    batcher.endComposition();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.at(-1)).toMatchObject({ block: second });
  });
});
