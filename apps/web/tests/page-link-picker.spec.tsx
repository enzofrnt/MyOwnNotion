// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { blockNoteSchema } from "../src/features/editor/blocknote-schema.ts";
import { editorLinkAtPosition } from "../src/features/editor/editor-links.ts";
import {
  PageLinkPicker,
  pageLinkOptions,
} from "../src/features/editor/editor-menus/page-link-picker.tsx";

function item(
  name: string,
  options: { readonly parentId?: string | null; readonly icon?: string | null } = {},
): ProjectedItem {
  const id = generateUuidV7();
  return {
    id,
    kind: "page",
    name,
    icon: options.icon ?? null,
    lifecycle: "active",
    currentRevisionId: generateUuidV7(),
    trashedAt: null,
    purgeAfter: null,
    favourite: false,
    offlineIntent: false,
    localAvailability: "present",
    pageDocument: null,
    file: null,
    placements: [
      {
        id: generateUuidV7(),
        kind: "hierarchy",
        parentItemId: options.parentId ?? null,
        positionKey: "V",
      },
    ],
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

function firstLink(editor: EditorInstance) {
  for (let position = 0; position <= editor.prosemirrorState.doc.content.size; position += 1) {
    const link = editorLinkAtPosition(editor, position);
    if (link !== null) return link;
  }
  return null;
}

describe("page link picker", () => {
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

  it("builds searchable canonical paths with the target emoji", () => {
    const current = item("Courante");
    const parent = item("Projets", { icon: "📁" });
    const target = item("Architecture", { parentId: parent.id, icon: "🏗️" });

    expect(pageLinkOptions([current, target, parent], current.id)).toEqual([
      expect.objectContaining({ id: parent.id, name: "Projets", icon: "📁" }),
      expect.objectContaining({
        id: target.id,
        name: "Architecture",
        path: "Notes / Projets / Architecture",
        icon: "🏗️",
      }),
    ]);
  });

  it("finds a page and validates it with ArrowDown/Enter into a UUID-only relation", async () => {
    const current = item("Courante");
    const first = item("Alpha");
    const target = item("Archive", { icon: "📚" });
    const editor = emptyEditor();
    const onClose = vi.fn();
    const selection = {
      from: editor.prosemirrorState.selection.from,
      to: editor.prosemirrorState.selection.to,
      text: "",
    };

    await act(async () => {
      root.render(
        <PageLinkPicker
          currentItemId={current.id}
          editor={editor}
          items={[current, first, target]}
          request={{ mode: "create", selection }}
          onClose={onClose}
          onError={vi.fn()}
        />,
      );
    });
    const query = document.querySelector<HTMLInputElement>('[aria-label="Rechercher une page"]');
    if (query === null) throw new Error("page query missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        query,
        "archive",
      );
      query.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="page-link-picker"]')?.textContent).toContain(
      "Archive",
    );
    await act(async () => {
      query.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      query.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(firstLink(editor)).toMatchObject({
      kind: "page",
      target: target.id,
      text: "Archive",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
