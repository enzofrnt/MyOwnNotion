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

function expectInvalid(body: unknown, expectedPath: string) {
  const result = validateDocumentV3(body);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.problems.map(({ path }) => path)).toContain(expectedPath);
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

  it("parses an already-wrapped unknown block to itself and keeps its digest stable", async () => {
    // The conversion handshake digests the local document on the device and
    // re-digests the supplied envelope on the server. The device sends the
    // canonical in-memory blocks — wrappers included — so a second parse that
    // nested a fresh wrapper inside the first would change the canonical
    // bytes and reject an honest branch with digest-mismatch forever.
    const stored = { type: "kanbanBoard", id: generateUuidV7(), columns: 2, nested: { v: [1] } };
    const firstPass = expectValid({ blocks: [stored] });
    const wireBody = {
      blocks: JSON.parse(JSON.stringify(firstPass.blocks)) as unknown[],
    };
    const secondPass = expectValid(wireBody);
    expect(secondPass).toEqual(firstPass);
    expect(canonicalDocumentJsonV3(secondPass)).toBe(canonicalDocumentJsonV3(firstPass));
    expect(await documentDigestV3(wireBody as BlockDocumentV3)).toBe(
      await documentDigestV3(firstPass),
    );
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

  it("reports malformed document, block, inline and mark structures precisely", () => {
    const blockId = generateUuidV7();
    const targetItemId = generateUuidV7();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "kept";
    const arrayWithProperty = Object.assign(["kept"], { future: true });
    const symbolKey = Symbol("future");
    const objectWithSymbol = { [symbolKey]: true };
    const objectWithHiddenProperty = Object.defineProperty({}, "hidden", {
      enumerable: false,
      value: true,
    });
    const objectWithAccessor = Object.defineProperty({}, "accessor", {
      enumerable: true,
      get: () => true,
    });
    const throwingPrototype = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("prototype unavailable");
        },
      },
    );
    let tooDeep: unknown = { type: "paragraph", id: generateUuidV7(), content: [] };
    for (let depth = 0; depth < 33; depth += 1) {
      tooDeep = {
        type: "toggle",
        id: generateUuidV7(),
        content: [],
        children: [tooDeep],
      };
    }

    const invalidCases: readonly {
      readonly body: unknown;
      readonly path: string;
    }[] = [
      { body: null, path: "" },
      { body: circular, path: "" },
      { body: { blocks: [], future: true }, path: "future" },
      { body: { blocks: "not-an-array" }, path: "blocks" },
      { body: { blocks: [null] }, path: "blocks[0]" },
      { body: { blocks: [{ id: blockId }] }, path: "blocks[0].type" },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: "bad" }] },
        path: "blocks[0].content",
      },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: [null] }] },
        path: "blocks[0].content[0]",
      },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: [{}] }] },
        path: "blocks[0].content[0].text",
      },
      {
        body: {
          blocks: [
            { type: "paragraph", id: blockId, content: [{ text: String.fromCharCode(0xd800) }] },
          ],
        },
        path: "blocks[0].content[0].text",
      },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "\u0001" }] }] },
        path: "blocks[0].content[0].text",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [{ text: "x".repeat(1_048_577) }] }],
        },
        path: "blocks[0].content[0].text",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [{ text: "x", future: true }] }],
        },
        path: "blocks[0].content[0].future",
      },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: [{ text: "x", marks: 1 }] }] },
        path: "blocks[0].content[0].marks",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [{ text: "x", marks: [null] }] }],
        },
        path: "blocks[0].content[0].marks[0]",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [{ text: "x", marks: [{}] }] }],
        },
        path: "blocks[0].content[0].marks[0].type",
      },
      {
        body: {
          blocks: [
            {
              type: "paragraph",
              id: blockId,
              content: [{ text: "x", marks: [{ type: "bold", future: true }] }],
            },
          ],
        },
        path: "blocks[0].content[0].marks[0].future",
      },
      {
        body: {
          blocks: [
            {
              type: "paragraph",
              id: blockId,
              content: [{ text: "x", marks: [{ type: "link", href: "relative" }] }],
            },
          ],
        },
        path: "blocks[0].content[0].marks[0].href",
      },
      {
        body: {
          blocks: [
            {
              type: "paragraph",
              id: blockId,
              content: [{ text: "x", marks: [{ type: "pageLink", targetItemId: "bad" }] }],
            },
          ],
        },
        path: "blocks[0].content[0].marks[0].targetItemId",
      },
      {
        body: {
          blocks: [
            {
              type: "paragraph",
              id: blockId,
              content: [{ text: "x", marks: [{ type: "textColor", color: "cyan" }] }],
            },
          ],
        },
        path: "blocks[0].content[0].marks[0].color",
      },
      {
        body: {
          blocks: [
            {
              type: "paragraph",
              id: blockId,
              content: [
                {
                  text: "x",
                  marks: [
                    { type: "pageLink", targetItemId },
                    { type: "pageLink", targetItemId },
                  ],
                },
              ],
            },
          ],
        },
        path: "blocks[0].content[0].marks[1]",
      },
      {
        body: {
          blocks: [{ type: "toggle", id: blockId, content: [], children: "bad" }],
        },
        path: "blocks[0].children",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [], future: Number.NaN }],
        },
        path: "blocks[0].future",
      },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: [], future: sparse }] },
        path: "blocks[0].future[0]",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [], future: arrayWithProperty }],
        },
        path: "blocks[0].future",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [], future: objectWithSymbol }],
        },
        path: "blocks[0].future",
      },
      {
        body: {
          blocks: [
            { type: "paragraph", id: blockId, content: [], future: objectWithHiddenProperty },
          ],
        },
        path: "blocks[0].future.hidden",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [], future: objectWithAccessor }],
        },
        path: "blocks[0].future.accessor",
      },
      {
        body: {
          blocks: [{ type: "paragraph", id: blockId, content: [], future: throwingPrototype }],
        },
        path: "blocks[0].future",
      },
      {
        body: { blocks: [{ type: "paragraph", id: blockId, content: [], future: undefined }] },
        path: "blocks[0].future",
      },
    ];

    for (const { body, path } of invalidCases) expectInvalid(body, path);

    const deepResult = validateDocumentV3({ blocks: [tooDeep] });
    expect(deepResult.ok).toBe(false);
    if (!deepResult.ok) {
      expect(deepResult.problems.some((problem) => /children/u.test(problem.path))).toBe(true);
    }
  });

  it("rejects malformed properties for every structured V1 block", () => {
    const id = generateUuidV7();
    const columnId = generateUuidV7();
    const rowId = generateUuidV7();
    const cellId = generateUuidV7();
    const fileItemId = generateUuidV7();
    const table = (columns: unknown, rows: unknown) => ({ type: "table", id, columns, rows });
    const validColumn = { id: columnId, width: null };
    const validCell = { id: cellId, content: [] };
    const validRow = { id: rowId, cells: [validCell] };
    const invalidCases: readonly { readonly block: unknown; readonly path: string }[] = [
      { block: { type: "heading", id, level: 4, content: [] }, path: "blocks[0].level" },
      { block: { type: "checkbox", id, checked: "yes", content: [] }, path: "blocks[0].checked" },
      { block: { type: "code", id, text: 1, language: null }, path: "blocks[0].text" },
      { block: { type: "code", id, text: "x", language: false }, path: "blocks[0].language" },
      {
        block: { type: "code", id, text: "x", language: "x".repeat(101) },
        path: "blocks[0].language",
      },
      {
        block: { type: "callout", id, content: [], icon: 1, tone: "default" },
        path: "blocks[0].icon",
      },
      {
        block: { type: "callout", id, content: [], icon: "A", tone: "default" },
        path: "blocks[0].icon",
      },
      {
        block: { type: "callout", id, content: [], icon: null, tone: "cyan" },
        path: "blocks[0].tone",
      },
      { block: table([], [validRow]), path: "blocks[0].columns" },
      { block: table([validColumn], []), path: "blocks[0].rows" },
      { block: table([null], [validRow]), path: "blocks[0].columns[0]" },
      {
        block: table([{ ...validColumn, future: true }], [validRow]),
        path: "blocks[0].columns[0].future",
      },
      { block: table([{ id: "bad", width: null }], [validRow]), path: "blocks[0].columns[0].id" },
      {
        block: table([{ id: columnId, width: 79 }], [validRow]),
        path: "blocks[0].columns[0].width",
      },
      { block: table([validColumn], [null]), path: "blocks[0].rows[0]" },
      {
        block: table([validColumn], [{ ...validRow, future: true }]),
        path: "blocks[0].rows[0].future",
      },
      {
        block: table([validColumn], [{ id: "bad", cells: [validCell] }]),
        path: "blocks[0].rows[0].id",
      },
      { block: table([validColumn], [{ id: rowId, cells: [] }]), path: "blocks[0].rows[0].cells" },
      {
        block: table([validColumn], [{ id: rowId, cells: [null] }]),
        path: "blocks[0].rows[0].cells[0]",
      },
      {
        block: table([validColumn], [{ id: rowId, cells: [{ ...validCell, future: true }] }]),
        path: "blocks[0].rows[0].cells[0].future",
      },
      {
        block: {
          type: "image",
          id,
          fileItemId: "bad",
          caption: null,
          altText: null,
          displayWidth: null,
        },
        path: "blocks[0].fileItemId",
      },
      {
        block: { type: "image", id, fileItemId, caption: 1, altText: null, displayWidth: null },
        path: "blocks[0].caption",
      },
      {
        block: { type: "image", id, fileItemId, caption: null, altText: 1, displayWidth: null },
        path: "blocks[0].altText",
      },
      {
        block: { type: "image", id, fileItemId, caption: null, altText: null, displayWidth: 79 },
        path: "blocks[0].displayWidth",
      },
      {
        block: { type: "fileEmbed", id, fileItemId, caption: false },
        path: "blocks[0].caption",
      },
      {
        block: {
          type: "embed",
          id,
          provider: "unknown",
          sourceUrl: "https://example.com",
          caption: null,
        },
        path: "blocks[0].provider",
      },
      {
        block: { type: "embed", id, provider: "bookmark", sourceUrl: "not-a-url", caption: null },
        path: "blocks[0].sourceUrl",
      },
      {
        block: {
          type: "embed",
          id,
          provider: "bookmark",
          sourceUrl: "https://user:secret@example.com",
          caption: null,
        },
        path: "blocks[0].sourceUrl",
      },
      {
        block: {
          type: "embed",
          id,
          provider: "bookmark",
          sourceUrl: "https://example.com?api_key=secret",
          caption: null,
        },
        path: "blocks[0].sourceUrl",
      },
      {
        block: {
          type: "embed",
          id,
          provider: "bookmark",
          sourceUrl: "https://example.com",
          caption: false,
        },
        path: "blocks[0].caption",
      },
    ];

    for (const { block, path } of invalidCases) expectInvalid({ blocks: [block] }, path);
  });

  it("accepts each allowlisted HTTPS embed host", () => {
    const embeds = [
      ["bookmark", "https://example.com/path"],
      ["youtube", "https://www.youtube.com/watch?v=123"],
      ["youtube", "https://youtu.be/123"],
      ["vimeo", "https://player.vimeo.com/video/123"],
      ["figma", "https://www.figma.com/file/123"],
      ["github", "https://github.com/enzofrnt/MyOwnNotion"],
      ["drawio", "https://app.diagrams.net/"],
      ["drawio", "https://embed.draw.io/"],
    ] as const;

    expectValid({
      blocks: embeds.map(([provider, sourceUrl]) => ({
        type: "embed",
        id: generateUuidV7(),
        provider,
        sourceUrl,
        caption: null,
      })),
    });
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

  it("reports malformed envelopes and prefixes body problems", () => {
    expect(validatePageDocumentEnvelopeV3(null).ok).toBe(false);
    const result = validatePageDocumentEnvelopeV3({
      format: "other",
      formatVersion: 2,
      body: { blocks: [{ type: "heading", id: "bad", level: 9, content: [] }] },
      future: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["future", "format", "formatVersion", "body.blocks[0].id"]),
    );
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
