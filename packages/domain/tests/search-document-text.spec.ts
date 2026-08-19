import { asUuid, type BlockDocument, extractSearchableDocumentText } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const ids = {
  paragraph: asUuid("018f0000-0000-7000-8000-000000000001"),
  list: asUuid("018f0000-0000-7000-8000-000000000002"),
  nested: asUuid("018f0000-0000-7000-8000-000000000003"),
  code: asUuid("018f0000-0000-7000-8000-000000000004"),
  embed: asUuid("018f0000-0000-7000-8000-000000000005"),
  file: asUuid("018f0000-0000-7000-8000-000000000006"),
  unknown: asUuid("018f0000-0000-7000-8000-000000000007"),
};

describe("extractSearchableDocumentText", () => {
  it("extracts visible inline text, nested blocks, code and file captions in order", () => {
    const document: BlockDocument = {
      blocks: [
        {
          type: "paragraph",
          id: ids.paragraph,
          content: [
            { text: "Architecture ", marks: [{ type: "bold" }] },
            {
              text: "résiliente",
              marks: [{ type: "link", href: "https://private.example/hidden-path" }],
            },
          ],
        },
        {
          type: "bulletedListItem",
          id: ids.list,
          content: [{ text: "Parent" }],
          children: [
            {
              type: "quote",
              id: ids.nested,
              content: [{ text: "Enfant imbriqué" }],
            },
          ],
        },
        { type: "code", id: ids.code, text: "const safe = true;", language: "ts" },
        {
          type: "fileEmbed",
          id: ids.embed,
          fileItemId: ids.file,
          caption: "Schéma final",
        },
      ],
    };

    const text = extractSearchableDocumentText(document);
    expect(text).toBe(
      "Architecture résiliente\nParent\nEnfant imbriqué\nconst safe = true;\nSchéma final",
    );
    expect(text).not.toContain("private.example");
    expect(text).not.toContain(ids.file);
  });

  it("does not interpret unknown blocks or arbitrary legacy payloads", () => {
    const document: BlockDocument = {
      blocks: [
        {
          type: "unknown",
          id: ids.unknown,
          declaredType: "futurePrivateBlock",
          syntheticId: false,
          raw: {
            type: "futurePrivateBlock",
            id: ids.unknown,
            content: "must-not-be-indexed",
            url: "https://secret.invalid/token",
          },
        },
      ],
    };

    expect(extractSearchableDocumentText(document)).toBe("");
  });

  it("keeps user text literal instead of parsing HTML", () => {
    const document: BlockDocument = {
      blocks: [
        {
          type: "paragraph",
          id: ids.paragraph,
          content: [{ text: '<img src=x onerror="alert(1)">' }],
        },
      ],
    };

    expect(extractSearchableDocumentText(document)).toBe('<img src=x onerror="alert(1)">');
  });

  it("drops dividers, empty captions and unsafe control characters", () => {
    const document: BlockDocument = {
      blocks: [
        { type: "divider", id: ids.paragraph },
        { type: "code", id: ids.code, text: "alpha\u0000beta", language: null },
        { type: "fileEmbed", id: ids.embed, fileItemId: ids.file, caption: null },
      ],
    };

    expect(extractSearchableDocumentText(document)).toBe("alpha beta");
  });
});
