import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
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

  it("publishes a whole IME composition as one transaction batch", async () => {
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
    await vi.waitFor(() => expect(batches).toHaveLength(1));

    expect(batches[0]?.at(-1)).toMatchObject({ block: second });
  });

  it("coalesces fast typing behind one durable write without delaying the first key", async () => {
    const batches: EditorBlocksChanged[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await firstCommit;
    });

    const first = paragraph("a");
    const second = paragraph("ab");
    const final = paragraph("abc");
    batcher.push([
      { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
    ] as EditorBlocksChanged);
    expect(batches).toHaveLength(1);

    batcher.push([
      { type: "update", block: second, prevBlock: first, source: { type: "local" } },
    ] as EditorBlocksChanged);
    batcher.push([
      { type: "update", block: final, prevBlock: second, source: { type: "local" } },
    ] as EditorBlocksChanged);
    expect(batches).toHaveLength(1);

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[1]).toEqual([
      expect.objectContaining({ type: "update", prevBlock: first, block: final }),
    ]);
  });

  it("does not coalesce updates across a structural editor change", async () => {
    const batches: EditorBlocksChanged[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await firstCommit;
    });
    const first = paragraph("a");
    const second = paragraph("ab");
    const final = paragraph("abc");
    const inserted = {
      ...paragraph(""),
      id: "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2057",
    } as EditorBlock;

    batcher.push([
      { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
    ] as EditorBlocksChanged);
    batcher.push([
      { type: "update", block: second, prevBlock: first, source: { type: "local" } },
      { type: "insert", block: inserted, prevBlock: undefined, source: { type: "local" } },
      { type: "update", block: final, prevBlock: second, source: { type: "local" } },
    ] as EditorBlocksChanged);

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[1]?.map((change) => change.type)).toEqual(["update", "insert", "update"]);
  });
});
