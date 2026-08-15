/**
 * fast-check generators for the block content model (feature 003).
 *
 * These live in `@myownnotion/test-utils` rather than beside one test suite
 * because two levels need the same generator and must agree on it: the domain
 * asserts that normalisation and export behave over every document, and the web
 * client asserts that a model → editor → model round trip is the identity over
 * the same set. If each wrote its own arbitrary, the round-trip property would
 * quietly stop covering the shapes the domain considers legal.
 *
 * Reached through the `@myownnotion/test-utils/documents` subpath so that a
 * browser-environment suite can import it without pulling in `pg` and
 * Testcontainers.
 */

import {
  type Block,
  type BlockDocument,
  generateUuidV7,
  type Inline,
  type JsonObject,
  type Mark,
  type UnknownBlock,
} from "@myownnotion/domain";
import fc from "fast-check";

/** Text that exercises escaping without generating unpaired surrogates. */
const textArbitrary = fc
  .string({ minLength: 1, maxLength: 24, unit: "grapheme" })
  .filter((value) => value.trim().length > 0);

const hrefArbitrary = fc.constantFrom(
  "https://example.org/",
  "https://example.org/a?b=c#d",
  "http://127.0.0.1:3000/x",
  "mailto:someone@example.org",
);

const markArbitrary: fc.Arbitrary<Mark> = fc.oneof(
  fc.constant<Mark>({ type: "bold" }),
  fc.constant<Mark>({ type: "italic" }),
  fc.constant<Mark>({ type: "strikethrough" }),
  fc.constant<Mark>({ type: "code" }),
  hrefArbitrary.map<Mark>((href) => ({ type: "link", href })),
);

export const inlineArbitrary: fc.Arbitrary<Inline> = fc
  .tuple(
    textArbitrary,
    fc.option(fc.uniqueArray(markArbitrary, { maxLength: 3 }), { nil: undefined }),
  )
  .map(([text, marks]) => (marks === undefined || marks.length === 0 ? { text } : { text, marks }));

const contentArbitrary = fc.array(inlineArbitrary, { minLength: 0, maxLength: 4 });

/**
 * A block type this client does not know about.
 *
 * Deliberately includes a nested object and an array, because the preservation
 * guarantee is about arbitrary content and a generator that only produced flat
 * objects would prove almost nothing.
 */
export const unknownBlockArbitrary: fc.Arbitrary<UnknownBlock> = fc
  .tuple(
    fc.constantFrom("kanbanBoard", "embed", "futureThing", "unknown"),
    fc.dictionary(fc.constantFrom("a", "b", "payload", "columns"), fc.jsonValue(), {
      maxKeys: 4,
    }),
  )
  .map(([declaredType, extras]) => {
    const id = generateUuidV7();
    // Built the way a stored block arrives: one object, carried whole.
    const raw = { type: declaredType, id, ...extras } as JsonObject;
    return { type: "unknown", id, declaredType, raw, syntheticId: false };
  });

function leafBlockArbitrary(): fc.Arbitrary<Block> {
  return fc.oneof(
    contentArbitrary.map<Block>((content) => ({
      type: "paragraph",
      id: generateUuidV7(),
      content,
    })),
    fc
      .tuple(fc.constantFrom<1 | 2 | 3>(1, 2, 3), contentArbitrary)
      .map<Block>(([level, content]) => ({
        type: "heading",
        id: generateUuidV7(),
        level,
        content,
      })),
    fc
      .tuple(
        fc.string({ maxLength: 40 }),
        fc.option(fc.constantFrom("ts", "python"), { nil: null }),
      )
      .map<Block>(([text, language]) => ({
        type: "code",
        id: generateUuidV7(),
        text,
        language,
      })),
    fc.constant<Block>({ type: "divider", id: generateUuidV7() }),
    unknownBlockArbitrary,
  );
}

function containerBlockArbitrary(children: fc.Arbitrary<Block>): fc.Arbitrary<Block> {
  return fc
    .tuple(
      fc.constantFrom("bulletedListItem", "numberedListItem", "quote", "checkbox"),
      contentArbitrary,
      fc.array(children, { maxLength: 2 }),
      fc.boolean(),
    )
    .map<Block>(([type, content, kids, checked]) => {
      const base = {
        id: generateUuidV7(),
        content,
        ...(kids.length > 0 ? { children: kids } : {}),
      };
      return type === "checkbox"
        ? ({ type: "checkbox", checked, ...base } as Block)
        : ({ type, ...base } as Block);
    });
}

/** Blocks up to three levels deep. Depth is bounded to keep runs fast. */
export const blockArbitrary: fc.Arbitrary<Block> = fc.letrec<{ block: Block }>((tie) => ({
  block: fc.oneof(
    { maxDepth: 3, depthSize: "small" },
    leafBlockArbitrary(),
    containerBlockArbitrary(tie("block")),
  ),
})).block;

export const documentArbitrary: fc.Arbitrary<BlockDocument> = fc
  .array(blockArbitrary, { maxLength: 8 })
  .map((blocks) => ({ blocks }));

/** A document guaranteed to contain at least one unrecognised block. */
export const documentWithUnknownBlockArbitrary: fc.Arbitrary<BlockDocument> = fc
  .tuple(fc.array(blockArbitrary, { maxLength: 4 }), unknownBlockArbitrary)
  .map(([blocks, unknown]) => ({ blocks: [...blocks, unknown as Block] }));
