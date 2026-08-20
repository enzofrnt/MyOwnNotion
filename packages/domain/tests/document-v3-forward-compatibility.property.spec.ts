import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  generateUuidV7,
  normaliseDocumentV3,
  serialiseDocumentV3,
  validateDocumentV3,
} from "../src/index.ts";

describe("v3 forward compatibility", () => {
  it("preserves arbitrary unknown blocks without interpreting them", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue(), {
          maxKeys: 10,
        }),
        (payload) => {
          const raw = {
            ...payload,
            type: "futureCanvas",
            id: generateUuidV7(),
            nested: { future: [1, { value: true }] },
          };
          const result = validateDocumentV3({ blocks: [raw] });
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          expect(serialiseDocumentV3(normaliseDocumentV3(result.document))).toEqual({
            blocks: [raw],
          });
        },
      ),
    );
  });

  it("preserves unknown marks and known-block extra properties", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (markPayload, blockPayload) => {
        const rawMark = { type: "futureMark", payload: markPayload };
        const body = {
          blocks: [
            {
              type: "paragraph",
              id: generateUuidV7(),
              content: [{ text: "kept", marks: [rawMark] }],
              futureProperty: blockPayload,
            },
          ],
        };
        const result = validateDocumentV3(body);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(serialiseDocumentV3(normaliseDocumentV3(result.document))).toEqual(body);
      }),
    );
  });
});
