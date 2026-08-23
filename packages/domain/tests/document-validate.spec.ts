/**
 * What validation accepts and what it refuses (T013, US1, FR-006).
 *
 * The whole design of `validateDocument` is one distinction, and these tests
 * are that distinction written twice:
 *
 *   - **permissive about what we do not recognise** — an unknown block type is
 *     the future arriving, not corruption, and rejecting it would turn a newer
 *     client's document into an error page on the owner's older device;
 *   - **strict about what we do** — a heading at level 9 or a checkbox with no
 *     `checked` is corruption or attack, and normalising it into something
 *     plausible would hide the first while executing the second.
 */

import { describe, expect, it } from "vitest";
import {
  generateUuidV7,
  isSafeHref,
  isUnknownBlock,
  serialiseDocument,
  validateDocument,
} from "../src/index.ts";

function body(...blocks: unknown[]): unknown {
  return { blocks };
}

function expectOk(result: ReturnType<typeof validateDocument>) {
  if (!result.ok) {
    throw new Error(`expected a valid document, got: ${JSON.stringify(result.problems)}`);
  }
  return result.document;
}

describe("what is accepted", () => {
  it("accepts an empty document", () => {
    expect(expectOk(validateDocument({ blocks: [] })).blocks).toEqual([]);
  });

  it("accepts every known block type", () => {
    const document = expectOk(
      validateDocument(
        body(
          { type: "paragraph", id: generateUuidV7(), content: [{ text: "hello" }] },
          { type: "heading", id: generateUuidV7(), level: 2, content: [{ text: "title" }] },
          { type: "bulletedListItem", id: generateUuidV7(), content: [{ text: "one" }] },
          { type: "numberedListItem", id: generateUuidV7(), content: [{ text: "two" }] },
          { type: "checkbox", id: generateUuidV7(), checked: true, content: [{ text: "done" }] },
          { type: "quote", id: generateUuidV7(), content: [{ text: "said" }] },
          { type: "code", id: generateUuidV7(), text: "x = 1", language: "python" },
          { type: "divider", id: generateUuidV7() },
        ),
      ),
    );
    expect(document.blocks).toHaveLength(8);
  });

  it("accepts nested children on a list item", () => {
    const document = expectOk(
      validateDocument(
        body({
          type: "bulletedListItem",
          id: generateUuidV7(),
          content: [{ text: "parent" }],
          children: [
            { type: "checkbox", id: generateUuidV7(), checked: false, content: [{ text: "kid" }] },
          ],
        }),
      ),
    );
    const parent = document.blocks[0];
    expect(parent?.type).toBe("bulletedListItem");
  });
});

describe("an unknown block type", () => {
  it("is accepted rather than rejected", () => {
    // Forward compatibility, and the reason it is a requirement: an owner with
    // two devices must not find that the older one refuses their notes.
    const document = expectOk(
      validateDocument(body({ type: "kanbanBoard", id: generateUuidV7(), columns: 3 })),
    );
    const block = document.blocks[0];
    expect(block).toBeDefined();
    expect(block !== undefined && isUnknownBlock(block)).toBe(true);
  });

  it("keeps the declared type for the placeholder", () => {
    const document = expectOk(
      validateDocument(body({ type: "kanbanBoard", id: generateUuidV7() })),
    );
    const block = document.blocks[0];
    expect(block !== undefined && isUnknownBlock(block) ? block.declaredType : null).toBe(
      "kanbanBoard",
    );
  });

  it("serialises back to exactly what was stored", () => {
    // The property SC-009 states. Note there is no `content` field and no
    // normalisation: the value is carried, not interpreted.
    const stored = { type: "kanbanBoard", id: generateUuidV7(), columns: 3, nested: { a: [1, 2] } };
    const document = expectOk(validateDocument(body(stored)));
    expect(serialiseDocument(document)).toEqual({ blocks: [stored] });
  });

  it("mints a session id when the stored block has none, without writing it back", () => {
    // An unknown block from a client that does not use ids still has to be
    // addressable in the editor. Adding the id to the owner's data in order to
    // display it would be a change we have no reason to make.
    const stored = { type: "kanbanBoard", columns: 3 };
    const document = expectOk(validateDocument(body(stored)));
    const block = document.blocks[0];
    expect(block !== undefined && isUnknownBlock(block) ? block.syntheticId : null).toBe(true);
    expect(serialiseDocument(document)).toEqual({ blocks: [stored] });
  });

  it("treats a block declaring the literal type `unknown` as unrecognised", () => {
    // Not a collision with the in-memory discriminator: a type we do not have
    // is a type we do not have, whatever it is called.
    const stored = { type: "unknown", id: generateUuidV7(), payload: "?" };
    const document = expectOk(validateDocument(body(stored)));
    expect(serialiseDocument(document)).toEqual({ blocks: [stored] });
  });

  it("parses an already-wrapped unknown block to itself, not a nested wrapper", () => {
    // A client that parsed a document once puts the canonical in-memory
    // wrapper back on the wire. The next parse — the server re-reading a
    // supplied envelope, or this device re-reading its own write — must land
    // on the same block again. Nesting a wrapper inside itself would change
    // the canonical bytes and silently break every digest over the document.
    const stored = { type: "kanbanBoard", id: generateUuidV7(), columns: 3, nested: { a: [1] } };
    const firstPass = expectOk(validateDocument(body(stored)));
    const wireBody = { blocks: JSON.parse(JSON.stringify(firstPass.blocks)) as unknown[] };
    const secondPass = expectOk(validateDocument(wireBody));
    expect(secondPass).toEqual(firstPass);
  });
});

describe("a malformed known block", () => {
  it("rejects a heading at an out-of-range level", () => {
    const result = validateDocument(
      body({ type: "heading", id: generateUuidV7(), level: 9, content: [] }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a checkbox without `checked`", () => {
    const result = validateDocument(body({ type: "checkbox", id: generateUuidV7(), content: [] }));
    expect(result.ok).toBe(false);
  });

  it("rejects a code block without `text`", () => {
    const result = validateDocument(body({ type: "code", id: generateUuidV7(), language: null }));
    expect(result.ok).toBe(false);
  });

  it("rejects a block with no id", () => {
    const result = validateDocument(body({ type: "paragraph", content: [] }));
    expect(result.ok).toBe(false);
  });

  it("reports every problem rather than only the first", () => {
    // An owner shown one problem at a time learns their document is broken in
    // an unbounded number of ways.
    const result = validateDocument(
      body(
        { type: "heading", id: generateUuidV7(), level: 9, content: [] },
        { type: "checkbox", id: generateUuidV7(), content: [] },
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.problems.length : 0).toBeGreaterThanOrEqual(2);
  });

  it("names where the problem is", () => {
    const result = validateDocument(
      body({ type: "heading", id: generateUuidV7(), level: 9, content: [] }),
    );
    expect(result.ok === false ? result.problems[0]?.path : "").toBe("blocks[0].level");
  });
});

describe("link hrefs", () => {
  it("rejects a javascript: URL at validation, not at render", () => {
    // An href that merely fails to render is one that survives into the stored
    // document and waits for the next reader with a different renderer.
    const result = validateDocument(
      body({
        type: "paragraph",
        id: generateUuidV7(),
        content: [{ text: "click", marks: [{ type: "link", href: "javascript:alert(1)" }] }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it.each(["https://example.org/x", "http://127.0.0.1:3000", "mailto:someone@example.org"])(
    "accepts %s",
    (href) => {
      expect(isSafeHref(href)).toBe(true);
    },
  );

  it.each(["javascript:alert(1)", "data:text/html,<script>", "/relative/path", "not a url"])(
    "rejects %s",
    (href) => {
      expect(isSafeHref(href)).toBe(false);
    },
  );
});

describe("internal page links", () => {
  it("accepts a canonical target UUID", () => {
    const targetItemId = generateUuidV7();
    const document = expectOk(
      validateDocument(
        body({
          type: "paragraph",
          id: generateUuidV7(),
          content: [{ text: "Reference", marks: [{ type: "pageLink", targetItemId }] }],
        }),
      ),
    );
    expect(document.blocks[0]).toMatchObject({
      content: [{ text: "Reference", marks: [{ type: "pageLink", targetItemId }] }],
    });
  });

  it("rejects an invalid target identity", () => {
    const result = validateDocument(
      body({
        type: "paragraph",
        id: generateUuidV7(),
        content: [{ text: "Reference", marks: [{ type: "pageLink", targetItemId: "child" }] }],
      }),
    );
    expect(result.ok).toBe(false);
  });
});
