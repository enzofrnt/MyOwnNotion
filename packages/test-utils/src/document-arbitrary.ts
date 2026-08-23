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
  type BlockDocumentV3,
  type CanonicalBlockV3,
  COLOR_TOKENS,
  type ColorToken,
  generateUuidV7,
  type Inline,
  type InlineV3,
  type JsonObject,
  type Mark,
  type MarkV3,
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
    fc.option(
      // Unique *by mark type*, not structurally. The default comparison treats
      // two links with different hrefs as two distinct values, and generated
      // documents where one run of text linked to two places — which the model
      // does not allow and the editor schema rejects outright. A generator that
      // produces illegal documents does not test the model harder, it tests a
      // model that does not exist.
      fc.uniqueArray(markArbitrary, { maxLength: 3, selector: (mark) => mark.type }),
      { nil: undefined },
    ),
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

const colorTokenArbitrary = fc.constantFrom<ColorToken>(...COLOR_TOKENS);

const compatibleMarksV3Arbitrary: fc.Arbitrary<readonly MarkV3[] | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.constant<readonly MarkV3[]>([{ type: "code" }]),
  fc
    .tuple(
      fc.uniqueArray(
        fc.oneof(
          fc.constant<MarkV3>({ type: "bold" }),
          fc.constant<MarkV3>({ type: "italic" }),
          fc.constant<MarkV3>({ type: "underline" }),
          fc.constant<MarkV3>({ type: "strikethrough" }),
          colorTokenArbitrary.map<MarkV3>((color) => ({ type: "textColor", color })),
          colorTokenArbitrary.map<MarkV3>((color) => ({ type: "backgroundColor", color })),
        ),
        { maxLength: 4, selector: (mark) => mark.type },
      ),
      fc.option(
        fc.oneof(
          hrefArbitrary.map<MarkV3>((href) => ({ type: "link", href })),
          fc.constant(null).map<MarkV3>(() => ({
            type: "pageLink",
            targetItemId: generateUuidV7(),
          })),
        ),
        { nil: undefined },
      ),
    )
    .map(([styles, link]) => {
      const marks = link === undefined ? styles : [...styles, link];
      return marks.length === 0 ? undefined : marks;
    }),
);

export const inlineV3Arbitrary: fc.Arbitrary<InlineV3> = fc
  .tuple(textArbitrary, compatibleMarksV3Arbitrary)
  .map(([text, marks]) => (marks === undefined ? { text } : { text, marks }));

const contentV3Arbitrary = fc.array(inlineV3Arbitrary, { maxLength: 4 });

export const unknownBlockV3Arbitrary: fc.Arbitrary<CanonicalBlockV3> = fc
  .tuple(
    fc.constantFrom("futureCanvas", "futureDatabase", "futureThing"),
    fc.dictionary(fc.constantFrom("payload", "layout", "columns"), fc.jsonValue(), {
      maxKeys: 3,
    }),
  )
  .map(([declaredType, payload]) => {
    const id = generateUuidV7();
    const raw = { type: declaredType, id, ...payload } as JsonObject;
    return { type: "unknown", id, declaredType, raw, syntheticId: false };
  });

function tableBlockV3Arbitrary(): fc.Arbitrary<CanonicalBlockV3> {
  return fc.integer({ min: 1, max: 4 }).chain((columnCount) =>
    fc
      .tuple(
        fc.array(fc.option(fc.integer({ min: 80, max: 1_200 }), { nil: null }), {
          minLength: columnCount,
          maxLength: columnCount,
        }),
        fc.array(
          fc.array(
            // Table-in-table is invalid even through a cell child. Keep the
            // generated cell payload focused on the independently addressable
            // rich text; nested non-table blocks are covered by the catalogue
            // fixture and the domain's dedicated validation suites.
            fc.tuple(contentV3Arbitrary, fc.constant<CanonicalBlockV3[]>([])),
            { minLength: columnCount, maxLength: columnCount },
          ),
          { minLength: 1, maxLength: 4 },
        ),
      )
      .map(([widths, rows]) => ({
        type: "table" as const,
        id: generateUuidV7(),
        columns: widths.map((width) => ({ id: generateUuidV7(), width })),
        rows: rows.map((cells) => ({
          id: generateUuidV7(),
          cells: cells.map(([content, children]) => ({
            id: generateUuidV7(),
            content,
            ...(children.length === 0 ? {} : { children }),
          })),
        })),
      })),
  );
}

function leafBlockV3Arbitrary(): fc.Arbitrary<CanonicalBlockV3> {
  return fc.oneof(
    contentV3Arbitrary.map((content) => ({
      type: "paragraph" as const,
      id: generateUuidV7(),
      content,
    })),
    fc.tuple(fc.constantFrom<1 | 2 | 3>(1, 2, 3), contentV3Arbitrary).map(([level, content]) => ({
      type: "heading" as const,
      id: generateUuidV7(),
      level,
      content,
    })),
    fc
      .tuple(
        fc.string({ maxLength: 80 }),
        fc.option(fc.constantFrom("ts", "python"), { nil: null }),
      )
      .map(([text, language]) => ({
        type: "code" as const,
        id: generateUuidV7(),
        text,
        language,
      })),
    fc.constant(null).map(() => ({ type: "divider" as const, id: generateUuidV7() })),
    fc
      .tuple(
        fc.option(textArbitrary, { nil: null }),
        fc.option(textArbitrary, { nil: null }),
        fc.option(fc.integer({ min: 80, max: 2_400 }), { nil: null }),
      )
      .map(([caption, altText, displayWidth]) => ({
        type: "image" as const,
        id: generateUuidV7(),
        fileItemId: generateUuidV7(),
        caption,
        altText,
        displayWidth,
      })),
    fc.option(textArbitrary, { nil: null }).map((caption) => ({
      type: "fileEmbed" as const,
      id: generateUuidV7(),
      fileItemId: generateUuidV7(),
      caption,
    })),
    fc
      .tuple(
        fc.constantFrom(
          ["bookmark", "https://example.org/article"] as const,
          ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"] as const,
          ["github", "https://github.com/enzofrnt/MyOwnNotion"] as const,
        ),
        fc.option(textArbitrary, { nil: null }),
      )
      .map(([[provider, sourceUrl], caption]) => ({
        type: "embed" as const,
        id: generateUuidV7(),
        provider,
        sourceUrl,
        caption,
      })),
    unknownBlockV3Arbitrary,
  );
}

function containerBlockV3Arbitrary(
  children: fc.Arbitrary<CanonicalBlockV3>,
): fc.Arbitrary<CanonicalBlockV3> {
  return fc
    .tuple(
      fc.constantFrom(
        "bulletedListItem",
        "numberedListItem",
        "checkbox",
        "quote",
        "toggle",
        "callout",
      ),
      contentV3Arbitrary,
      fc.array(children, { maxLength: 2 }),
      fc.boolean(),
      fc.option(fc.constantFrom("💡", "⚠️", "✅"), { nil: null }),
      colorTokenArbitrary,
    )
    .map(([type, content, nested, checked, icon, tone]) => {
      const common = {
        id: generateUuidV7(),
        content,
        ...(nested.length === 0 ? {} : { children: nested }),
      };
      if (type === "checkbox") return { type, checked, ...common };
      if (type === "callout") return { type, icon, tone, ...common };
      return { type, ...common } as CanonicalBlockV3;
    });
}

/** Complete v3 catalogue, bounded to keep cross-package property suites fast. */
export const blockV3Arbitrary: fc.Arbitrary<CanonicalBlockV3> = fc.letrec<{
  block: CanonicalBlockV3;
}>((tie) => ({
  block: fc.oneof(
    { maxDepth: 3, depthSize: "small" },
    leafBlockV3Arbitrary(),
    containerBlockV3Arbitrary(tie("block")),
    tableBlockV3Arbitrary(),
  ),
})).block;

export const documentV3Arbitrary: fc.Arbitrary<BlockDocumentV3> = fc
  .array(blockV3Arbitrary, { minLength: 1, maxLength: 8 })
  .map((blocks) => ({ blocks }));
