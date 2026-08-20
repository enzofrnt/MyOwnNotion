import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalDocumentJsonV3,
  documentDigestV3,
  generateUuidV7,
  normaliseDocumentV3,
  serialiseDocumentV3,
  validateDocumentV3,
} from "../src/index.ts";

const knownMark = fc.constantFrom(
  { type: "bold" as const },
  { type: "italic" as const },
  { type: "underline" as const },
  { type: "strikethrough" as const },
);

describe("v3 normalisation properties", () => {
  it("is idempotent for arbitrary inline boundaries and mark order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            text: fc.string({ maxLength: 30, unit: "grapheme" }),
            marks: fc.uniqueArray(knownMark, { maxLength: 4, selector: (mark) => mark.type }),
          }),
          { maxLength: 20 },
        ),
        (content) => {
          const result = validateDocumentV3({
            blocks: [{ type: "paragraph", id: generateUuidV7(), content }],
          });
          if (!result.ok) return;
          const once = normaliseDocumentV3(result.document);
          const twice = normaliseDocumentV3(once);
          expect(serialiseDocumentV3(twice)).toEqual(serialiseDocumentV3(once));
        },
      ),
    );
  });

  it("gives identical bytes and digests to equivalent opaque key orders", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), fc.jsonValue(), {
          maxKeys: 8,
        }),
        async (properties) => {
          const id = generateUuidV7();
          const entries = Object.entries(properties).filter(
            ([key]) => !["type", "id", "content", "rawExtraProperties"].includes(key),
          );
          const left = Object.fromEntries(entries);
          const right = Object.fromEntries([...entries].reverse());
          const parse = (extras: Record<string, unknown>) =>
            validateDocumentV3({
              blocks: [{ ...extras, type: "paragraph", id, content: [{ text: "stable" }] }],
            });
          const parsedLeft = parse(left);
          const parsedRight = parse(right);
          if (!parsedLeft.ok || !parsedRight.ok) return;

          expect(canonicalDocumentJsonV3(parsedLeft.document)).toBe(
            canonicalDocumentJsonV3(parsedRight.document),
          );
          expect(await documentDigestV3(parsedLeft.document)).toBe(
            await documentDigestV3(parsedRight.document),
          );
        },
      ),
    );
  });
});
