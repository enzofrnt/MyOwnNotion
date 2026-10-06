import { type BlockDocumentV3, generateUuidV7 } from "@myownnotion/domain";
import { OperationalPageDocument } from "@myownnotion/page-state";
import { describe, expect, it } from "vitest";
import {
  blockNoteDocumentToCanonical,
  canonicalDocumentToBlockNote,
} from "../src/features/editor/blocknote-conversion.ts";
import type { EditorBlock } from "../src/features/editor/blocknote-schema.ts";
import { commandsFromBlockNoteChanges } from "../src/features/editor/editor-adapter.ts";
import { renderMath } from "../src/features/editor/math.tsx";

describe("native math and contents", () => {
  it("round trips multiline inline source, annotations, adjacent formulas and nontext blocks", () => {
    const expression = "\\frac{a}{b}\n + c";
    const doc: BlockDocumentV3 = {
      blocks: [
        { type: "equation", id: generateUuidV7(), expression },
        { type: "tableOfContents", id: generateUuidV7() },
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [0, 1].map(() => ({
            text: expression.replace(/\n/g, " "),
            marks: [
              { type: "equation", equationId: generateUuidV7(), expression },
              { type: "bold" },
            ],
          })),
        },
      ],
    };
    expect(
      blockNoteDocumentToCanonical(canonicalDocumentToBlockNote(doc) as EditorBlock[]),
    ).toEqual(doc);
  });
  it("clears slash input, changes type then persists source edits in the operational authority", () => {
    const id = generateUuidV7(),
      pageId = generateUuidV7();
    const before = {
      id,
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "/latex", styles: {} }],
      children: [],
    } as EditorBlock;
    const after = {
      id,
      type: "equation",
      props: { expression: "" },
      content: undefined,
      children: [],
    } as EditorBlock;
    const commands = commandsFromBlockNoteChanges({
      changes: [{ type: "update", block: after, prevBlock: before, source: { type: "local" } }],
      document: [after],
    });
    const page = OperationalPageDocument.create({
      pageId,
      document: { blocks: [{ type: "paragraph", id, content: [{ text: "/latex" }] }] },
    });
    page.transact(commands);
    const edited = { ...after, props: { expression: "\\sqrt{x}" } } as EditorBlock;
    const edit = commandsFromBlockNoteChanges({
      changes: [{ type: "update", block: edited, prevBlock: after, source: { type: "local" } }],
      document: [edited],
    });
    expect(edit).toEqual([
      { type: "set-block-property", blockId: id, key: "expression", value: "\\sqrt{x}" },
    ]);
    page.transact(edit);
    expect(page.snapshot().blocks[0]).toEqual({ type: "equation", id, expression: "\\sqrt{x}" });
  });
  it("renders valid math, preserves invalid source and blocks remote/HTML commands and expansion abuse", () => {
    expect(renderMath("\\frac{1}{2}", true).html).toContain("katex");
    expect(renderMath("\\frac{", false)).toEqual({ html: null, error: true });
    for (const source of [
      "\\includegraphics{https://example.org/private}",
      "\\href{javascript:alert(1)}{x}",
      "\\htmlStyle{color:red}{x}",
    ]) {
      const html = renderMath(source, false).html ?? "";
      expect(html).not.toMatch(/<(?:img|a)\b/);
      expect(html).not.toContain('style="color:red');
    }
    expect(renderMath("\\def\\a{\\a}\\a", false).error).toBe(true);
  });
});
