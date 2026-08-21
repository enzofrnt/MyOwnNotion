import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { OperationalPageDocument, PageUndoManager } from "../src/index.ts";

function paragraph(id: Uuid, text: string) {
  return { type: "paragraph" as const, id, content: text === "" ? [] : [{ text }] };
}

describe("local operational undo", () => {
  it("undoes and redoes one atomic gesture", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "avant")] },
    });
    const history = new PageUndoManager(page);

    history.execute([{ type: "replace-text", blockId, from: 0, to: 5, text: "après" }]);
    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "après")]);
    expect(history.canUndo).toBe(true);

    history.undo();
    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "avant")]);
    expect(history.canRedo).toBe(true);

    history.redo();
    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "après")]);
  });

  it("rejects a non-invertible property gesture before changing the document", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "inchangé")] },
    });
    const history = new PageUndoManager(page);

    expect(() =>
      history.execute([
        {
          type: "set-block-property",
          blockId,
          key: "nouvellePropriété",
          value: "valeur",
        },
      ]),
    ).toThrow("did not exist before this transaction");

    expect(page.snapshot().blocks).toEqual([paragraph(blockId, "inchangé")]);
    expect(history.canUndo).toBe(false);
  });

  it("does not put a remote update on the local undo stack", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const remoteId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "local")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    const update = remote.transact([
      {
        type: "insert-block",
        block: paragraph(remoteId, "distant"),
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);

    history.importRemote(update.updateBytes);

    expect(history.canUndo).toBe(false);
    expect(local.snapshot().blocks.map((block) => block.id)).toEqual([firstId, remoteId]);
  });

  it("keeps a remote insertion while undoing the last local text edit", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const remoteId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(firstId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId: firstId, from: 4, to: 4, text: " locale" }]);
    const update = remote.transact([
      {
        type: "insert-block",
        block: paragraph(remoteId, "distante"),
        parentBlockId: null,
        beforeBlockId: null,
      },
    ]);
    history.importRemote(update.updateBytes);

    history.undo();

    expect(local.snapshot().blocks).toEqual([
      paragraph(firstId, "base"),
      paragraph(remoteId, "distante"),
    ]);
  });

  it("refuses to undo stale text offsets after a remote edit of the same block", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId, from: 4, to: 4, text: " locale" }]);
    const remoteEdit = remote.transact([
      { type: "replace-text", blockId, from: 0, to: 0, text: "distant " },
    ]);
    history.importRemote(remoteEdit.updateBytes);
    const beforeUndo = local.snapshot();

    expect(() => history.undo()).toThrow("undo target");
    expect(history.canUndo).toBe(true);
    expect(local.snapshot()).toEqual(beforeUndo);
  });

  it("preserves a remote text edit while undoing a local move", async () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const movedId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [paragraph(firstId, "premier"), paragraph(movedId, "second")],
      },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([
      { type: "move-block", blockId: movedId, parentBlockId: null, beforeBlockId: firstId },
    ]);
    const remoteEdit = remote.transact([
      { type: "replace-text", blockId: movedId, from: 6, to: 6, text: " distant" },
    ]);
    history.importRemote(remoteEdit.updateBytes);

    history.undo();

    expect(local.snapshot().blocks).toEqual([
      paragraph(firstId, "premier"),
      paragraph(movedId, "second distant"),
    ]);
  });

  it("moves a contiguous group and restores its relative order with one undo", () => {
    const pageId = generateUuidV7();
    const firstId = generateUuidV7();
    const secondId = generateUuidV7();
    const thirdId = generateUuidV7();
    const page = OperationalPageDocument.create({
      pageId,
      document: {
        blocks: [
          paragraph(firstId, "first"),
          paragraph(secondId, "second"),
          paragraph(thirdId, "third"),
        ],
      },
    });
    const history = new PageUndoManager(page);

    history.execute([
      { type: "move-block", blockId: thirdId, parentBlockId: null, beforeBlockId: firstId },
      { type: "move-block", blockId: secondId, parentBlockId: null, beforeBlockId: thirdId },
    ]);
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([secondId, thirdId, firstId]);

    history.undo();
    expect(page.snapshot().blocks.map((block) => block.id)).toEqual([firstId, secondId, thirdId]);
  });

  it("restores the exact previous mark spans after a formatting gesture", () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const source = {
      type: "paragraph" as const,
      id: blockId,
      content: [{ text: "ab", marks: [{ type: "bold" as const }] }, { text: "cd" }],
    };
    const page = OperationalPageDocument.create({ pageId, document: { blocks: [source] } });
    const history = new PageUndoManager(page);

    history.execute([
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 2,
        mark: { type: "bold" },
        enabled: false,
      },
      {
        type: "set-mark",
        blockId,
        from: 0,
        to: 4,
        mark: { type: "bold" },
        enabled: true,
      },
    ]);
    expect(page.snapshot().blocks[0]).toMatchObject({
      content: [{ text: "abcd", marks: [{ type: "bold" }] }],
    });

    history.undo();
    expect(page.snapshot().blocks[0]).toEqual(source);
  });

  it("reports an explicit failure when a remote deletion removed the local undo target", async () => {
    const pageId = generateUuidV7();
    const blockId = generateUuidV7();
    const local = OperationalPageDocument.create({
      pageId,
      document: { blocks: [paragraph(blockId, "base")] },
    });
    const remote = await OperationalPageDocument.fromCheckpoint({
      pageId,
      checkpoint: await local.checkpoint(),
    });
    const history = new PageUndoManager(local);
    history.execute([{ type: "replace-text", blockId, from: 4, to: 4, text: " locale" }]);
    const deletion = remote.transact([{ type: "delete-block", blockId }]);
    history.importRemote(deletion.updateBytes);

    expect(() => history.undo()).toThrow("undo could not be applied after newer changes");
    expect(history.canUndo).toBe(true);
    expect(local.snapshot().blocks).toEqual([]);
  });
});
