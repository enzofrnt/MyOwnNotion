import {
  EMPTY_EDITOR_DOCUMENT,
  normalizePageDocumentForEditor,
  type PageDocument,
  toPageDocument,
  validateEditorDocument,
  validatePageDocument,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

const completeDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Title", marks: [{ type: "bold" }, { type: "italic" }] }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Body" }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Three" }] }],
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }],
        },
      ],
    },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }],
    },
    {
      type: "codeBlock",
      attrs: { language: null },
      content: [{ type: "text", text: "const x = 1" }],
    },
    { type: "horizontalRule" },
  ],
} as const;

describe("editor document v2", () => {
  it("accepts every supported node and mark without changing content", () => {
    const result = validateEditorDocument(completeDocument);
    expect(result).toEqual({ ok: true, value: completeDocument });
    expect(
      validatePageDocument({
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: completeDocument,
      }).ok,
    ).toBe(true);
  });

  it("normalizes only an empty legacy v1 body", () => {
    const result = normalizePageDocumentForEditor({
      format: "myownnotion.document+json",
      formatVersion: 1,
      body: {},
    });
    expect(result).toEqual({ ok: true, value: EMPTY_EDITOR_DOCUMENT });

    const incompatible = normalizePageDocumentForEditor({
      format: "myownnotion.document+json",
      formatVersion: 1,
      body: { text: "legacy content without a migration rule" },
    });
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) {
      expect(incompatible.error.code).toBe("document.unsupported-content");
    }
  });

  it("normalizes current documents and converts editor content to the page envelope", () => {
    expect(
      normalizePageDocumentForEditor({
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: completeDocument,
      }),
    ).toEqual({ ok: true, value: completeDocument });
    expect(toPageDocument(completeDocument)).toEqual({
      format: "myownnotion.document+json",
      formatVersion: 2,
      body: completeDocument,
    });

    const unsupportedFormat = normalizePageDocumentForEditor({
      format: "unsupported.document+json",
      formatVersion: 2,
      body: completeDocument,
    } as unknown as PageDocument);
    expect(unsupportedFormat.ok).toBe(false);
    if (!unsupportedFormat.ok) {
      expect(unsupportedFormat.error.code).toBe("document.unsupported-content");
      expect(unsupportedFormat.error.invalidFields?.[0]?.field).toBe("document.format");
    }
  });

  it.each([
    ["unknown node", { type: "doc", content: [{ type: "futureWidget", secret: "never echo" }] }],
    [
      "unknown mark",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "private", marks: [{ type: "futureMark" }] }],
          },
        ],
      },
    ],
    ["invalid heading", { type: "doc", content: [{ type: "heading", attrs: { level: 7 } }] }],
    [
      "mixed task list",
      {
        type: "doc",
        content: [
          { type: "taskList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        ],
      },
    ],
    [
      "marked code",
      {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            content: [{ type: "text", text: "private", marks: [{ type: "bold" }] }],
          },
        ],
      },
    ],
  ])("rejects %s with content-free diagnostics", (_label, body) => {
    const result = validateEditorDocument(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.title).not.toContain("private");
      expect(JSON.stringify(result.error)).not.toContain("never echo");
      expect(result.error.invalidFields?.[0]?.field).toMatch(/^body/);
    }
  });

  it("rejects an empty root and arbitrary attributes", () => {
    expect(validateEditorDocument({ type: "doc", content: [] }).ok).toBe(false);
    expect(
      validateEditorDocument({
        type: "doc",
        content: [{ type: "paragraph", attrs: { color: "red" } }],
      }).ok,
    ).toBe(false);
  });

  it.each([
    [
      "non-array marks",
      {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: {} }] }],
      },
    ],
    [
      "invalid mark shape",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "bold", attrs: {} }] }],
          },
        ],
      },
    ],
    [
      "duplicate marks",
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", marks: [{ type: "bold" }, { type: "bold" }] }],
          },
        ],
      },
    ],
    ["non-array text content", { type: "doc", content: [{ type: "paragraph", content: {} }] }],
    ["invalid heading attributes", { type: "doc", content: [{ type: "heading", attrs: "one" }] }],
    [
      "heading with extra fields",
      { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, future: true }] },
    ],
    ["empty bullet list", { type: "doc", content: [{ type: "bulletList", content: [] }] }],
    [
      "list item with extra fields",
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [{ type: "paragraph" }], future: true }],
          },
        ],
      },
    ],
    [
      "task without checked state",
      {
        type: "doc",
        content: [
          { type: "taskList", content: [{ type: "taskItem", content: [{ type: "paragraph" }] }] },
        ],
      },
    ],
    [
      "empty list item",
      {
        type: "doc",
        content: [{ type: "bulletList", content: [{ type: "listItem", content: [] }] }],
      },
    ],
    [
      "list item not starting with a paragraph",
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [{ type: "horizontalRule" }] }],
          },
        ],
      },
    ],
    [
      "invalid nested list block",
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph" }, { type: "futureWidget" }] },
            ],
          },
        ],
      },
    ],
    ["invalid block primitive", { type: "doc", content: [null] }],
    ["empty blockquote", { type: "doc", content: [{ type: "blockquote", content: [] }] }],
    [
      "invalid nested quote block",
      { type: "doc", content: [{ type: "blockquote", content: [{ type: "futureWidget" }] }] },
    ],
    [
      "code block with extra fields",
      { type: "doc", content: [{ type: "codeBlock", future: true }] },
    ],
    [
      "code block with invalid attributes",
      { type: "doc", content: [{ type: "codeBlock", attrs: [] }] },
    ],
    [
      "code block with invalid language",
      { type: "doc", content: [{ type: "codeBlock", attrs: { language: 7 } }] },
    ],
    [
      "horizontal rule with extra fields",
      { type: "doc", content: [{ type: "horizontalRule", content: [] }] },
    ],
    [
      "bullet list with extra fields",
      { type: "doc", content: [{ type: "bulletList", content: [], future: true }] },
    ],
    [
      "bullet list with invalid attributes",
      { type: "doc", content: [{ type: "bulletList", attrs: [], content: [] }] },
    ],
    [
      "ordered list with extra fields",
      { type: "doc", content: [{ type: "orderedList", content: [], future: true }] },
    ],
    [
      "ordered list with invalid attributes",
      { type: "doc", content: [{ type: "orderedList", attrs: [], content: [] }] },
    ],
    [
      "ordered list with invalid start",
      {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 0 },
            content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
          },
        ],
      },
    ],
    [
      "task list with extra fields",
      { type: "doc", content: [{ type: "taskList", content: [], future: true }] },
    ],
  ])("rejects malformed structure: %s", (_label, body) => {
    expect(validateEditorDocument(body).ok).toBe(false);
  });
});
