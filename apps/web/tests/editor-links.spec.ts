// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { generateUuidV7 } from "@myownnotion/domain";
import { Selection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import type { EditorInstance } from "../src/features/editor/blocknote-schema.ts";
import { blockNoteSchema } from "../src/features/editor/blocknote-schema.ts";
import {
  clearStaleLinkTypingState,
  createEditorLink,
  editorLinkAtPosition,
  removeEditorLink,
  resolveEditorLinkTarget,
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

  it("converts a page link to Web and back without losing its visible text", () => {
    const { editor } = pageLinkEditor();
    const pageLink = firstLink(editor);
    if (pageLink === null) throw new Error("page link missing");

    expect(
      updateEditorLink(editor, pageLink, {
        kind: "external",
        target: "https://example.com/converti",
        text: "Même texte",
      }),
    ).toBe(true);
    const external = firstLink(editor);
    expect(external).toMatchObject({
      kind: "external",
      target: "https://example.com/converti",
      text: "Même texte",
    });
    if (external === null) throw new Error("external link missing");

    const target = generateUuidV7();
    expect(
      updateEditorLink(editor, external, {
        kind: "page",
        target,
        text: "Même texte",
      }),
    ).toBe(true);
    expect(firstLink(editor)).toMatchObject({ kind: "page", target, text: "Même texte" });
  });

  it("creates either kind of link through the same command", () => {
    const editor = BlockNoteEditor.create({
      schema: blockNoteSchema,
      initialContent: [
        { id: generateUuidV7(), type: "paragraph", content: "Texte sélectionné" },
      ] as unknown as PartialBlock[],
    }) as unknown as EditorInstance;
    let from: number | null = null;
    editor.prosemirrorState.doc.descendants((node, position) => {
      if (!node.isText) return true;
      from = position;
      return false;
    });
    if (from === null) throw new Error("text missing");
    const to: number = from + "Texte sélectionné".length;

    expect(
      createEditorLink(
        editor,
        { from, to },
        { kind: "external", target: "https://example.com", text: "Site" },
      ),
    ).toBe(true);
    expect(firstLink(editor)).toMatchObject({ kind: "external", text: "Site" });
  });

  it("resolves a page name or path before falling back to a safe Web address", () => {
    const target = generateUuidV7();
    const pages = [{ id: target, name: "Projet", path: "Notes / Projet" }];
    expect(resolveEditorLinkTarget("Notes / Projet", pages)).toEqual({
      kind: "page",
      target,
    });
    expect(resolveEditorLinkTarget("https://example.com", pages)).toEqual({
      kind: "external",
      target: "https://example.com/",
    });
    expect(resolveEditorLinkTarget("example.com/docs", pages)).toEqual({
      kind: "external",
      target: "https://example.com/docs",
    });
    expect(resolveEditorLinkTarget("javascript:alert(1)", pages)).toBeNull();
  });

  it("clears a stale link mark at a boundary before fresh typing", () => {
    const editor = externalLinkEditor();
    const link = firstLink(editor);
    if (link === null) throw new Error("external link missing");
    editor.transact((transaction) => {
      const linkMark = editor.pmSchema.marks["link"];
      if (linkMark === undefined) throw new Error("link mark missing");
      transaction.setSelection(
        // ProseMirror accepts a text selection at the right boundary.
        Selection.near(transaction.doc.resolve(link.to)),
      );
      transaction.addStoredMark(linkMark.create({ href: link.target }));
    });

    expect(clearStaleLinkTypingState(editor)).toBe(true);
    expect(
      editor.prosemirrorState.storedMarks?.some((mark) => mark.type.name === "link") ?? false,
    ).toBe(false);
  });
});
