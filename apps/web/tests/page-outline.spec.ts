import { describe, expect, it } from "vitest";
import {
  activeHeadingId,
  collectPageHeadings,
} from "../src/features/editor/page-outline.tsx";

describe("page outline", () => {
  it("collects heading levels in document order, including nested blocks", () => {
    expect(
      collectPageHeadings([
        { id: "p", type: "paragraph", content: [{ type: "text", text: "intro" }] },
        {
          id: "h1",
          type: "heading",
          props: { level: 1 },
          content: [{ type: "text", text: "Premier" }],
        },
        {
          id: "toggle",
          type: "toggleListItem",
          children: [
            {
              id: "h4",
              type: "heading",
              props: { level: 4 },
              content: [{ type: "text", text: "  Détail  " }],
            },
          ],
        },
        { id: "h9", type: "heading", props: { level: 9 }, content: [{ text: "ignoré" }] },
      ]),
    ).toEqual([
      { id: "h1", level: 1, text: "Premier" },
      { id: "h4", level: 4, text: "Détail" },
    ]);
  });

  it("marks the last heading that has reached the reading line", () => {
    const headings = [
      { id: "a", top: 20 },
      { id: "b", top: 400 },
      { id: "c", top: 800 },
    ];
    expect(activeHeadingId(headings, 120)).toBe("a");
    expect(activeHeadingId(headings, 500)).toBe("b");
    expect(activeHeadingId([], 0)).toBeNull();
  });
});