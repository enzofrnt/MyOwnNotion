// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { blockNoteSchema } from "../src/features/editor/blocknote-schema.ts";
import {
  editorLinkAtPosition,
  removeEditorLink,
  updateEditorLink,
} from "../src/features/editor/editor-links.ts";

function pageLinkEditor() {
  const firstTarget = generateUuidV7();
  const editor = BlockNoteEditor.create({
    schema: blockNoteSchema,
    initialContent: [
      {
        id: generateUuidV7(),
        type: "paragraph",
        content: [
          { type: "text", text: "Avant " },
          {
            type: "pageLink",
            props: { targetItemId: firstTarget },
            content: "Référence",
          },
          { type: "text", text: " après" },
        ],
      },
    ] as unknown as PartialBlock[],
  }) as unknown as EditorInstance;
  return { editor, firstTarget };
}

function externalLinkEditor() {
  return BlockNoteEditor.create({
    schema: blockNoteSchema,
    initialContent: [
      {
        id: generateUuidV7(),
        type: "paragraph",
        content: [
          {
            type: "link",
            href: "https://example.com/avant",
            content: "Site externe",
          },
        ],
      },
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

describe("editor link lifecycle", () => {
  it("finds and retargets a canonical page link while changing its visible text", () => {
    const { editor, firstTarget } = pageLinkEditor();
    const link = firstLink(editor);
    expect(link).toMatchObject({ kind: "page", target: firstTarget, text: "Référence" });
    if (link === null) throw new Error("page link missing");

    const secondTarget = generateUuidV7();
    expect(updateEditorLink(editor, link, { target: secondTarget, text: "Nouvelle page" })).toBe(
      true,
    );
    expect(firstLink(editor)).toMatchObject({
      kind: "page",
      target: secondTarget,
      text: "Nouvelle page",
    });
  });

  it("removes only the page-link relation and preserves its text", () => {
    const { editor } = pageLinkEditor();
    const link = firstLink(editor);
    if (link === null) throw new Error("page link missing");

    expect(removeEditorLink(editor, link)).toBe(true);
    expect(firstLink(editor)).toBeNull();
    const visible = JSON.stringify(editor.document);
    expect(visible).toContain("Référence");
    expect(visible).toContain("Avant ");
    expect(visible).toContain(" après");
    expect(visible).not.toContain('"type":"pageLink"');
  });

  it("uses the same update and unlink lifecycle for a standard Web link", () => {
    const editor = externalLinkEditor();
    const link = firstLink(editor);
    expect(link).toMatchObject({
      kind: "external",
      target: "https://example.com/avant",
      text: "Site externe",
    });
    if (link === null) throw new Error("external link missing");

    expect(
      updateEditorLink(editor, link, {
        target: "https://example.com/apres",
        text: "Nouveau site",
      }),
    ).toBe(true);
    const updated = firstLink(editor);
    expect(updated).toMatchObject({
      kind: "external",
      target: "https://example.com/apres",
      text: "Nouveau site",
    });
    if (updated === null) throw new Error("updated external link missing");
    expect(removeEditorLink(editor, updated)).toBe(true);
    expect(firstLink(editor)).toBeNull();
    expect(JSON.stringify(editor.document)).toContain("Nouveau site");
  });
});
