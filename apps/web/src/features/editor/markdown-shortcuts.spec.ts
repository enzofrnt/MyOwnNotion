import { describe, expect, it } from "vitest";
import { MARKDOWN_SHORTCUTS, matchingMarkdownShortcut } from "./markdown-shortcuts.ts";

describe("documented Markdown shortcuts", () => {
  it("recognizes every complete start-of-block fixture", () => {
    const fixtures = ["# ", "## ", "### ", "- ", "1. ", "[ ] ", "> ", "``` ", "---"];
    expect(fixtures.map((fixture) => matchingMarkdownShortcut(fixture)?.id)).toEqual(
      MARKDOWN_SHORTCUTS.map((shortcut) => shortcut.id),
    );
  });

  it("leaves incomplete and mid-block lookalikes unmatched", () => {
    const negativeFixtures = [
      "#",
      "text # ",
      "ordinary - ",
      "item 1. ",
      "text [ ] ",
      "quote > ",
      "code ``` ",
      "before---",
    ];
    for (const fixture of negativeFixtures) {
      expect(matchingMarkdownShortcut(fixture)).toBeNull();
    }
  });
});
