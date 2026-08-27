// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { blockNoteSchema } from "../src/features/editor/blocknote-schema.ts";
import {
  type EditorLinkDialogRequest,
  editorLinkAtPosition,
  editorLinkCreationFromSelection,
} from "../src/features/editor/editor-links.ts";
import { LinkEditorDialog } from "../src/features/editor/editor-menus/link-editor-dialog.tsx";

function page(name: string): ProjectedItem {
  const id = generateUuidV7();
  return {
    id,
    kind: "page",
    name,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    pageDocument: null,
    file: null,
    placements: [],
  } as ProjectedItem;
}

function emptyEditor(): EditorInstance {
  return BlockNoteEditor.create({
    schema: blockNoteSchema,
    initialContent: [
      { id: generateUuidV7(), type: "paragraph", content: "" },
    ] as unknown as PartialBlock[],
  }) as unknown as EditorInstance;
}

describe("link editor dialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps and submits the visible target through a synchronization-driven parent render", async () => {
    const editor = emptyEditor();
    const selection = editorLinkCreationFromSelection(editor);
    if (selection === null) throw new Error("empty paragraph selection missing");
    const request: EditorLinkDialogRequest = { mode: "create", selection };
    const currentItemId = generateUuidV7();
    const onClose = vi.fn();
    const renderDialog = (items: readonly ProjectedItem[]) => (
      <LinkEditorDialog
        currentItemId={currentItemId}
        editor={editor}
        items={items}
        request={request}
        onClose={onClose}
        onError={vi.fn()}
      />
    );

    act(() => root.render(renderDialog([])));
    const target = document.querySelector<HTMLInputElement>(
      '[data-testid="link-editor-dialog"] input[placeholder^="Nom de page"]',
    );
    expect(target).not.toBeNull();
    if (target === null) return;

    // This is the exact browser boundary captured by the failed WebKit trace:
    // the DOM already contains the owner's input while React has not committed
    // the corresponding state render, and a remote projection rerenders the
    // parent in that gap.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      target,
      "example.com/docs",
    );
    act(() => root.render(renderDialog([page("Projet distant")])));

    expect(target.value).toBe("example.com/docs");

    const save = document.querySelector<HTMLButtonElement>('[data-testid="save-editor-link"]');
    expect(save).not.toBeNull();
    await act(async () => {
      save?.click();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    const links = Array.from(
      { length: editor.prosemirrorState.doc.content.size + 1 },
      (_, position) => editorLinkAtPosition(editor, position),
    ).filter((link) => link?.kind === "external");
    expect(links[0]).toMatchObject({
      kind: "external",
      target: "https://example.com/docs",
    });
  });
});
