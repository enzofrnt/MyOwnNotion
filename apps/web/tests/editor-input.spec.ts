import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import type { EditorBlock, EditorBlocksChanged } from "../src/features/editor/blocknote-schema.ts";
import {
  commandsFromBlockNoteChanges,
  EditorChangeBatcher,
  minimalTextReplacement,
  rebaseBlockNoteChanges,
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

function heading(text: string): EditorBlock {
  return {
    ...paragraph(text),
    type: "heading",
    props: {
      backgroundColor: "default",
      textColor: "default",
      textAlignment: "left",
      level: 1,
    },
  } as EditorBlock;
}

function callout(text: string): EditorBlock {
  return {
    ...paragraph(text),
    type: "callout",
    props: { icon: "💡", tone: "yellow" },
  } as EditorBlock;
}

describe("editor input boundaries", () => {
  it("recovers a leading character omitted after a slash-menu transform", () => {
    const durable = callout("");
    const reportedBefore = callout("I");
    const visible = callout("Information mise en évidence");
    const changes = [
      {
        type: "update",
        block: visible,
        prevBlock: reportedBefore,
        source: { type: "local" },
      },
    ] as EditorBlocksChanged;

    const rebased = rebaseBlockNoteChanges(changes, [durable]);

    expect(rebased[0]).toMatchObject({ prevBlock: durable, block: visible });
    expect(commandsFromBlockNoteChanges({ changes: rebased, document: [visible] })).toEqual([
      {
        type: "replace-text",
        blockId: BLOCK_ID,
        from: 0,
        to: 0,
        text: "Information mise en évidence",
      },
    ]);
  });

  it("rebases consecutive updates on the result of the previous local change", () => {
    const durable = callout("");
    const first = callout("Info");
    const final = callout("Information");
    const changes = [
      {
        type: "update",
        block: first,
        prevBlock: callout("I"),
        source: { type: "local" },
      },
      {
        type: "update",
        block: final,
        prevBlock: first,
        source: { type: "local" },
      },
    ] as EditorBlocksChanged;

    const rebased = rebaseBlockNoteChanges(changes, [durable]);

    expect(rebased[0]).toMatchObject({ prevBlock: durable, block: first });
    expect(rebased[1]).toMatchObject({ prevBlock: first, block: final });
  });

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
    batcher.push(
      [
        { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
      ] as EditorBlocksChanged,
      [first],
    );
    batcher.push(
      [
        { type: "update", block: second, prevBlock: first, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [second],
    );
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
    batcher.push(
      [
        { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
      ] as EditorBlocksChanged,
      [first],
    );
    expect(batches).toHaveLength(1);

    batcher.push(
      [
        { type: "update", block: second, prevBlock: first, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [second],
    );
    batcher.push(
      [
        { type: "update", block: final, prevBlock: second, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [final],
    );
    expect(batches).toHaveLength(1);

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[1]).toEqual([
      expect.objectContaining({ type: "update", prevBlock: first, block: final }),
    ]);
  });

  it("preserves a remote origin while its editor echo waits behind a local commit", async () => {
    const publications: Array<{ readonly text: string; readonly origin: string }> = [];
    let releaseLocal: (() => void) | undefined;
    const localCommit = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch, _document, origin) => {
      const update = batch[0];
      if (update?.type !== "update") throw new Error("expected an editor update");
      publications.push({
        text: (update.block.content[0] as { readonly text: string }).text,
        origin,
      });
      if (publications.length === 1) await localCommit;
    });
    const local = paragraph("A — base");
    const remote = paragraph("base — B");

    batcher.push(
      [
        {
          type: "update",
          block: local,
          prevBlock: paragraph("base"),
          source: { type: "local" },
        },
      ] as EditorBlocksChanged,
      [local],
      "local",
    );
    batcher.push(
      [
        {
          type: "update",
          block: remote,
          prevBlock: local,
          source: { type: "local" },
        },
      ] as EditorBlocksChanged,
      [remote],
      "remote",
    );

    expect(publications).toEqual([{ text: "A — base", origin: "local" }]);
    releaseLocal?.();
    await vi.waitFor(() => expect(publications).toHaveLength(2));
    expect(publications[1]).toEqual({ text: "base — B", origin: "remote" });
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

    batcher.push(
      [
        { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
      ] as EditorBlocksChanged,
      [first],
    );
    batcher.push(
      [
        { type: "update", block: second, prevBlock: first, source: { type: "local" } },
        { type: "insert", block: inserted, prevBlock: undefined, source: { type: "local" } },
        { type: "update", block: final, prevBlock: second, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [final, inserted],
    );

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(2));
    expect(batches[1]?.map((change) => change.type)).toEqual(["update", "insert", "update"]);
  });

  it("keeps a semantic gesture after pending typing in its own transaction", async () => {
    const batches: EditorBlocksChanged[] = [];
    const documents: Array<readonly EditorBlock[]> = [];
    let releaseFirst: (() => void) | undefined;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch, document) => {
      batches.push(batch);
      documents.push(document);
      if (batches.length === 1) await firstCommit;
    });
    const initial = paragraph("");
    const partial = paragraph("av");
    const final = paragraph("avant");
    const transformed = heading("avant");

    batcher.push(
      [
        { type: "update", block: partial, prevBlock: initial, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [partial],
    );
    batcher.push(
      [
        { type: "update", block: final, prevBlock: partial, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [final],
    );
    batcher.push(
      [
        { type: "update", block: transformed, prevBlock: final, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [transformed],
    );

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(3));
    expect(batches[1]).toEqual([
      expect.objectContaining({ type: "update", prevBlock: partial, block: final }),
    ]);
    expect(batches[2]).toEqual([
      expect.objectContaining({ type: "update", prevBlock: final, block: transformed }),
    ]);
    expect(documents[1]).toEqual([transformed]);
    expect(documents[2]).toEqual([transformed]);
  });

  it("bridges an input-rule character emitted only in the semantic before-state", async () => {
    const batches: EditorBlocksChanged[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await firstCommit;
    });
    const initial = paragraph("");
    const first = paragraph("av");
    const partial = paragraph("avan");
    const semanticBefore = paragraph("avant");
    const transformed = heading("avant");

    batcher.push(
      [{ type: "update", block: first, prevBlock: initial, source: { type: "local" } }],
      [first],
    );
    batcher.push(
      [
        {
          type: "update",
          block: partial,
          prevBlock: first,
          source: { type: "local" },
        },
      ],
      [partial],
    );
    batcher.push(
      [
        {
          type: "update",
          block: transformed,
          prevBlock: semanticBefore,
          source: { type: "local" },
        },
      ],
      [transformed],
    );

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(3));
    expect(batches[1]).toEqual([
      expect.objectContaining({ type: "update", prevBlock: first, block: semanticBefore }),
    ]);
    expect(batches[2]).toEqual([
      expect.objectContaining({
        type: "update",
        prevBlock: semanticBefore,
        block: transformed,
      }),
    ]);
  });

  it("keeps separate structural notifications as separate owner gestures", async () => {
    const batches: EditorBlocksChanged[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await firstCommit;
    });
    const first = paragraph("premier");
    const second = { ...paragraph("second"), id: crypto.randomUUID() } as EditorBlock;
    const copy = { ...second, id: crypto.randomUUID() } as EditorBlock;

    batcher.push(
      [
        { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
      ] as EditorBlocksChanged,
      [first],
    );
    batcher.push(
      [{ type: "insert", block: second, prevBlock: undefined, source: { type: "local" } }],
      [first, second],
    );
    batcher.push(
      [{ type: "insert", block: copy, prevBlock: undefined, source: { type: "local" } }],
      [first, second, copy],
    );

    releaseFirst?.();
    await vi.waitFor(() => expect(batches).toHaveLength(3));
    expect(batches[1]?.map(({ type }) => type)).toEqual(["insert"]);
    expect(batches[2]?.map(({ type }) => type)).toEqual(["insert"]);
  });

  it("runs history only after delayed editor changes become durable", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const batcher = new EditorChangeBatcher(async (batch) => {
      order.push(`apply:${String(batch.at(-1)?.block.content)}`);
      if (order.length === 1) await firstCommit;
    });
    const first = paragraph("a");
    const second = paragraph("ab");

    batcher.push(
      [
        { type: "update", block: first, prevBlock: paragraph(""), source: { type: "local" } },
      ] as EditorBlocksChanged,
      [first],
    );
    const history = batcher.runAfterPendingChanges(() => {
      order.push("undo");
    });
    batcher.push(
      [
        { type: "update", block: second, prevBlock: first, source: { type: "local" } },
      ] as EditorBlocksChanged,
      [second],
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).not.toContain("undo");
    releaseFirst?.();
    await history;
    expect(order.at(-1)).toBe("undo");
    expect(order.filter((entry) => entry.startsWith("apply:"))).toHaveLength(2);
  });
});
