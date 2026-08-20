import { describe, expect, it } from "vitest";
import {
  type BlockDocumentV3,
  canonicalDocumentJsonV3,
  documentDigestV3,
  embeddedFilesV3,
  exportMarkdownV3,
  extractSearchableDocumentTextV3,
  generateUuidV7,
  normaliseDocumentV3,
  pageLinkTargetsV3,
  serialiseDocumentV3,
  validateDocumentV3,
  validatePageDocumentEnvelopeV3,
} from "../src/index.ts";

function expectValid(body: unknown) {
  const result = validateDocumentV3(body);
  if (!result.ok) {
    throw new Error(`expected a valid v3 document: ${JSON.stringify(result.problems)}`);
  }
  return result.document;
}

describe("the canonical v3 parser", () => {
  it("accepts the V1 block catalogue, including stable table identities", () => {
    const columnId = generateUuidV7();
    const document = expectValid({
      blocks: [
        { type: "paragraph", id: generateUuidV7(), content: [{ text: "Paragraph" }] },
        {
          type: "toggle",
          id: generateUuidV7(),
          content: [{ text: "Details" }],
          children: [{ type: "divider", id: generateUuidV7() }],
        },
        {
          type: "callout",
          id: generateUuidV7(),
          content: [{ text: "Attention" }],
          icon: "💡",
          tone: "yellow",
        },
        {
          type: "table",
          id: generateUuidV7(),
          columns: [{ id: columnId, width: 240 }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [{ id: generateUuidV7(), content: [{ text: "Cellule" }] }],
            },
          ],
        },
        {
          type: "image",
          id: generateUuidV7(),
          fileItemId: generateUuidV7(),
          caption: "Vue",
          altText: "Une vue",
          displayWidth: 640,
        },
        {
          type: "fileEmbed",
          id: generateUuidV7(),
          fileItemId: generateUuidV7(),
          caption: null,
        },
        {
          type: "embed",
          id: generateUuidV7(),
          provider: "github",
          sourceUrl: "https://github.com/enzofrnt/MyOwnNotion",
          caption: "Dépôt",
        },
      ],
    });

    expect(document.blocks).toHaveLength(7);
  });

  it("refuses ambiguous marks instead of choosing one silently", () => {
    const result = validateDocumentV3({
      blocks: [
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "x", marks: [{ type: "code" }, { type: "bold" }] }],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("refuses duplicate identities across blocks, rows, columns and cells", () => {
    const duplicate = generateUuidV7();
    const result = validateDocumentV3({
      blocks: [
        {
          type: "table",
          id: duplicate,
          columns: [{ id: generateUuidV7(), width: null }],
          rows: [
            {
              id: generateUuidV7(),
              cells: [{ id: duplicate, content: [] }],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it("refuses non-JSON opaque values instead of coercing them", () => {
    const withUndefined = validateDocumentV3({
      blocks: [
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [],
          futureValue: undefined,
        },
      ],
    });
    const withObjectPrototype = validateDocumentV3({
      blocks: [
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [],
          futureValue: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(withUndefined.ok).toBe(false);
    expect(withObjectPrototype.ok).toBe(false);
  });

  it("refuses a table nested indirectly inside a table cell", () => {
    const innerTable = {
      type: "table",
      id: generateUuidV7(),
      columns: [{ id: generateUuidV7(), width: null }],
      rows: [
        {
          id: generateUuidV7(),
          cells: [{ id: generateUuidV7(), content: [] }],
        },
      ],
    };
    const result = validateDocumentV3({
      blocks: [
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
                  content: [],
                  children: [
                    {
                      type: "toggle",
                      id: generateUuidV7(),
                      content: [],
                      children: [innerTable],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it.each([
    ["youtube", "http://youtube.com/watch?v=123"],
    ["youtube", "https://example.org/watch?v=123"],
    ["github", "https://github.com/example/repo?access_token=secret"],
  ])("refuses an unsafe %s embed", (provider, sourceUrl) => {
    const result = validateDocumentV3({
      blocks: [
        {
          type: "embed",
          id: generateUuidV7(),
          provider,
          sourceUrl,
          caption: null,
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

describe("v3 canonicalisation", () => {
  it("orders marks, drops empty runs and merges equivalent neighbours", () => {
    const id = generateUuidV7();
    const document = expectValid({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [
            { text: "", marks: [{ type: "bold" }] },
            { text: "A", marks: [{ type: "underline" }, { type: "bold" }] },
            { text: "B", marks: [{ type: "bold" }, { type: "underline" }] },
          ],
        },
      ],
    });

    expect(normaliseDocumentV3(document)).toEqual({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [{ text: "AB", marks: [{ type: "bold" }, { type: "underline" }] }],
        },
      ],
    });
  });

  it("serialises known keys before sorted opaque properties", () => {
    const id = generateUuidV7();
    const document = expectValid({
      blocks: [
        {
          zFuture: 2,
          type: "paragraph",
          aFuture: 1,
          id,
          content: [{ text: "x" }],
        },
      ],
    });

    expect(canonicalDocumentJsonV3(document)).toBe(
      `{"format":"myownnotion.document+json","formatVersion":3,"body":{"blocks":[{"type":"paragraph","id":"${id}","content":[{"text":"x"}],"aFuture":1,"zFuture":2}]}}`,
    );
    expect(serialiseDocumentV3(document)).toEqual({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [{ text: "x" }],
          aFuture: 1,
          zFuture: 2,
        },
      ],
    });
  });

  it("keeps known keys before integer-like opaque keys in canonical bytes", () => {
    const id = generateUuidV7();
    const document = expectValid({
      blocks: [
        {
          2: "two",
          10: "ten",
          type: "paragraph",
          id,
          content: [{ text: "x" }],
        },
      ],
    });

    expect(canonicalDocumentJsonV3(document)).toBe(
      `{"format":"myownnotion.document+json","formatVersion":3,"body":{"blocks":[{"type":"paragraph","id":"${id}","content":[{"text":"x"}],"10":"ten","2":"two"}]}}`,
    );
  });

  it("does not merge adjacent runs whose mark lists only share a delimiter-shaped key", () => {
    const targetItemId = generateUuidV7();
    const document = expectValid({
      blocks: [
        {
          type: "paragraph",
          id: generateUuidV7(),
          content: [
            {
              text: "A",
              marks: [
                { type: "link", href: "https://example.com/a" },
                { type: "pageLink", targetItemId },
              ],
            },
            {
              text: "B",
              marks: [{ type: "link", href: `https://example.com/a|pageLink:${targetItemId}` }],
            },
          ],
        },
      ],
    });

    const [block] = normaliseDocumentV3(document).blocks;
    expect(block).toMatchObject({ type: "paragraph" });
    if (block?.type !== "paragraph") return;
    expect(block.content).toHaveLength(2);
  });

  it("refuses an opaque property colliding with an optional known field", () => {
    const document: BlockDocumentV3 = {
      blocks: [
        {
          type: "toggle",
          id: generateUuidV7(),
          content: [],
          rawExtraProperties: { children: [] },
        },
      ],
    };

    expect(() => serialiseDocumentV3(document)).toThrow(/collides with known field/u);
    expect(() => canonicalDocumentJsonV3(document)).toThrow(/collides with known field/u);
  });

  it("digests the complete canonical envelope", async () => {
    const document = expectValid({ blocks: [] });
    await expect(documentDigestV3(document)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the v3 envelope", () => {
  it("accepts only the owned format at version 3", () => {
    expect(
      validatePageDocumentEnvelopeV3({
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: [] },
      }).ok,
    ).toBe(true);
    expect(
      validatePageDocumentEnvelopeV3({
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks: [] },
      }).ok,
    ).toBe(false);
  });
});

describe("v3 derived projections", () => {
  it("derives search text, links, file usages and durable export from rich blocks", () => {
    const targetItemId = generateUuidV7();
    const fileItemId = generateUuidV7();
    const imageBlockId = generateUuidV7();
    const document = expectValid({
      blocks: [
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
                  content: [
                    {
                      text: "Référence",
                      marks: [{ type: "pageLink", targetItemId }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "image",
          id: imageBlockId,
          fileItemId,
          caption: "Architecture",
          altText: "Schéma de synchronisation",
          displayWidth: null,
        },
      ],
    });

    expect(extractSearchableDocumentTextV3(document)).toContain("Référence");
    expect(extractSearchableDocumentTextV3(document)).toContain("Schéma de synchronisation");
    expect(pageLinkTargetsV3(document)).toEqual([targetItemId]);
    expect(embeddedFilesV3(document)).toEqual([
      { fileItemId, usageKind: "embed", blockId: imageBlockId },
    ]);
    expect(exportMarkdownV3(document)).toContain(`myownnotion://file/${fileItemId}`);
  });
});
