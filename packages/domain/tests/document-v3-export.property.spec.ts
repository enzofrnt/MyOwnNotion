import {
  type BlockDocumentV3,
  embeddedFilesV3,
  exportMarkdownV3,
  extractSearchableDocumentTextV3,
  generateUuidV7,
  pageLinkTargetsV3,
} from "@myownnotion/domain";
import { documentV3Arbitrary } from "@myownnotion/test-utils/documents";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("v3 export and extraction", () => {
  it("remain total for every valid rich document", () => {
    fc.assert(
      fc.property(documentV3Arbitrary, (document) => {
        expect(() => exportMarkdownV3(document)).not.toThrow();
        expect(() => extractSearchableDocumentTextV3(document)).not.toThrow();
        expect(() => embeddedFilesV3(document)).not.toThrow();
        expect(() => pageLinkTargetsV3(document)).not.toThrow();
        const markdown = exportMarkdownV3(document);
        expect(markdown.endsWith("\n")).toBe(true);
        expect(markdown.endsWith("\n\n")).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it("extracts rich text, nested table content, file references and stable links", () => {
    const targetItemId = generateUuidV7();
    const imageFileId = generateUuidV7();
    const attachedFileId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [
        {
          type: "callout",
          id: generateUuidV7(),
          icon: "💡",
          tone: "yellow",
          content: [{ text: "Référence", marks: [{ type: "pageLink", targetItemId }] }],
          children: [
            {
              type: "image",
              id: generateUuidV7(),
              fileItemId: imageFileId,
              caption: "Schéma local-first",
              altText: "Deux appareils convergent",
              displayWidth: 640,
            },
          ],
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: generateUuidV7(), width: null }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [
                {
                  id: generateUuidV7(),
                  content: [{ text: "Cellule durable" }],
                  children: [
                    {
                      type: "fileEmbed",
                      id: generateUuidV7(),
                      fileItemId: attachedFileId,
                      caption: "Archive chiffrée",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const markdown = exportMarkdownV3(document);
    const search = extractSearchableDocumentTextV3(document);

    expect(markdown).toContain(`myownnotion://page/${targetItemId}`);
    expect(markdown).toContain(`myownnotion://file/${imageFileId}`);
    expect(markdown).toContain("Cellule durable");
    expect(search).toContain("Référence");
    expect(search).toContain("Deux appareils convergent");
    expect(search).toContain("Archive chiffrée");
    expect(embeddedFilesV3(document).map(({ fileItemId }) => fileItemId)).toEqual([
      imageFileId,
      attachedFileId,
    ]);
    expect(pageLinkTargetsV3(document)).toEqual([targetItemId]);
  });

  it("uses a stable image label when alt text and caption are absent", () => {
    const fileItemId = generateUuidV7();
    const document: BlockDocumentV3 = {
      blocks: [
        {
          type: "image",
          id: generateUuidV7(),
          fileItemId,
          caption: null,
          altText: null,
          displayWidth: null,
        },
      ],
    };

    expect(exportMarkdownV3(document)).toContain(`![image](myownnotion://file/${fileItemId})`);
  });
});
