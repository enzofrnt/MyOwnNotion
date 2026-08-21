import { describe, expect, it } from "vitest";
import {
  type BlockDocument,
  generateUuidV7,
  migrateDocumentV2BodyToV3,
  migrateDocumentV2ToV3,
  readVersionedDocumentEnvelope,
  serialiseDocument,
  serialiseDocumentV3,
} from "../src/index.ts";

describe("the pure v2 to v3 migration", () => {
  it("preserves every known v2 field and identity", () => {
    const document: BlockDocument = {
      blocks: [
        { type: "paragraph", id: generateUuidV7(), content: [{ text: "Texte" }] },
        {
          type: "checkbox",
          id: generateUuidV7(),
          checked: true,
          content: [{ text: "Tâche" }],
          children: [{ type: "divider", id: generateUuidV7() }],
        },
      ],
    };

    expect(serialiseDocumentV3(migrateDocumentV2ToV3(document))).toEqual(
      serialiseDocument(document),
    );
  });

  it("migrates fileEmbed explicitly without dropping its reference or caption", () => {
    const fileItemId = generateUuidV7();
    const blockId = generateUuidV7();
    const document: BlockDocument = {
      blocks: [
        {
          type: "fileEmbed",
          id: blockId,
          fileItemId,
          caption: "Document source",
        },
      ],
    };

    expect(serialiseDocumentV3(migrateDocumentV2ToV3(document))).toEqual({
      blocks: [
        {
          type: "fileEmbed",
          id: blockId,
          fileItemId,
          caption: "Document source",
        },
      ],
    });
  });

  it("carries unknown v2 blocks byte-for-byte", () => {
    const raw = { type: "future", id: generateUuidV7(), payload: { z: 1, a: [2] } };
    const read = readVersionedDocumentEnvelope({
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: { blocks: [raw] },
    });
    expect(read.kind).toBe("v2");
    if (read.kind !== "v2" || !read.result.ok) return;

    expect(serialiseDocumentV3(migrateDocumentV2ToV3(read.result.document))).toEqual({
      blocks: [raw],
    });
  });

  it("moves unknown properties of known v2 blocks into the v3 opaque sidecar", () => {
    const id = generateUuidV7();
    const migrated = migrateDocumentV2BodyToV3({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [{ text: "Conservé" }],
          futureLayout: { columns: 2 },
        },
      ],
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    expect(serialiseDocumentV3(migrated.document)).toEqual({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [{ text: "Conservé" }],
          futureLayout: { columns: 2 },
        },
      ],
    });
  });

  it("preserves an unknown v2 mark as opaque v3 data", () => {
    const id = generateUuidV7();
    const futureMark = { type: "futureHighlight", palette: { name: "aurora" } };
    const migrated = migrateDocumentV2BodyToV3({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [{ text: "Conservé", marks: [{ type: "bold" }, futureMark] }],
        },
      ],
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;

    expect(serialiseDocumentV3(migrated.document)).toEqual({
      blocks: [
        {
          type: "paragraph",
          id,
          content: [{ text: "Conservé", marks: [{ type: "bold" }, futureMark] }],
        },
      ],
    });
  });
});

describe("versioned envelope reading", () => {
  it("dispatches v2 and v3 without guessing from the body", () => {
    expect(
      readVersionedDocumentEnvelope({
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: { blocks: [] },
      }).kind,
    ).toBe("v2");
    expect(
      readVersionedDocumentEnvelope({
        format: "myownnotion.document+json",
        formatVersion: 3,
        body: { blocks: [] },
      }).kind,
    ).toBe("v3");
  });

  it("keeps an unsupported envelope opaque", () => {
    const envelope = {
      format: "myownnotion.document+json",
      formatVersion: 99,
      body: { future: true },
    };
    const read = readVersionedDocumentEnvelope(envelope);
    expect(read).toMatchObject({ kind: "unsupported", envelope });
  });
});
