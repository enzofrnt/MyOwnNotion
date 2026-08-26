import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { createSubpageFromSlash } from "../src/features/editor/editor-menus/slash-menu.tsx";

describe("the /page command", () => {
  it("uses the current block identity for an idempotent child and turns it into its link", async () => {
    const blockId = generateUuidV7();
    const editor = {
      getTextCursorPosition: () => ({
        block: { id: blockId, type: "paragraph", content: [{ type: "text", text: "/page" }] },
      }),
      updateBlock: vi.fn(),
    };
    const createSubpage = vi.fn(async () => ({ id: blockId, title: "Sans titre" }));
    const onCreated = vi.fn();

    await createSubpageFromSlash(editor, createSubpage, onCreated);

    expect(createSubpage).toHaveBeenCalledWith({ id: blockId, title: "Sans titre" });
    expect(editor.updateBlock).toHaveBeenCalledWith(blockId, {
      type: "paragraph",
      content: [
        {
          type: "pageLink",
          props: { targetItemId: blockId },
          content: [{ type: "text", text: "Sans titre", styles: {} }],
        },
      ],
    });
    expect(onCreated).toHaveBeenCalledWith({ id: blockId, title: "Sans titre" });
    expect(editor.updateBlock.mock.invocationCallOrder[0]).toBeLessThan(
      onCreated.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("leaves the current block untouched when the child could not be created", async () => {
    const blockId = generateUuidV7();
    const editor = {
      getTextCursorPosition: () => ({ block: { id: blockId, type: "paragraph", content: [] } }),
      updateBlock: vi.fn(),
    };

    await expect(
      createSubpageFromSlash(editor, async () => {
        throw new Error("création refusée");
      }),
    ).rejects.toThrow("création refusée");
    expect(editor.updateBlock).not.toHaveBeenCalled();
  });
});
