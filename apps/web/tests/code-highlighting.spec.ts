import { describe, expect, it } from "vitest";
import {
  CODE_LANGUAGES,
  codeHighlightLanguage,
  createCodeHighlighter,
} from "../src/features/editor/code-highlighting.ts";

const snippets: Record<string, string> = {
  bash: '# Comment\necho "$HOME"',
  css: "/* Comment */\n.note { color: red; }",
  html: '<!-- Comment -->\n<div class="note">Hello</div>',
  javascript: '// Comment\nconst message = "Hello";',
  json: '{ "message": "Hello", "count": 3 }',
  jsx: 'const note = <Note title="Hello" />;',
  markdown: "# Heading\n**Hello** and `code`",
  python: '# Comment\ndef hello():\n    return "Hello"',
  sql: "-- Comment\nSELECT 'Hello' FROM notes;",
  tsx: 'const note: JSX.Element = <Note title="Hello" />;',
  typescript: '// Comment\nconst message: string = "Hello";',
  yaml: '# Comment\nmessage: "Hello"\ncount: 3',
};

describe("offline code highlighting", () => {
  it("highlights every offered language in both themes without losing source", async () => {
    const highlighter = await createCodeHighlighter();
    for (const { value } of CODE_LANGUAGES) {
      const source = snippets[value];
      expect(source).toBeDefined();
      for (const theme of ["github-light", "github-dark"]) {
        const tokens = highlighter.codeToTokensBase(source ?? "", { lang: value, theme });
        expect(tokens.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(
          source,
        );
        expect(
          new Set(tokens.flat().map((token) => token.color)).size,
          `${value}/${theme}`,
        ).toBeGreaterThan(1);
      }
    }
    expect(await createCodeHighlighter()).toBe(highlighter);
  });

  it("recognizes aliases without mutating unsupported or saved language values", () => {
    expect(codeHighlightLanguage(" TS ")).toBe("typescript");
    expect(codeHighlightLanguage("py")).toBe("python");
    expect(codeHighlightLanguage("shell")).toBe("bash");
    for (const value of ["", "text", "plaintext", "unknown-future-language"]) {
      expect(codeHighlightLanguage(value)).toBe("text");
    }
  });

  it("preserves Unicode, tabs, literal markup and trailing newlines in a 100-line snippet", async () => {
    const source = '// café 漢字 🚀\n\tconst html = "<script>alert(1)</script>";\n'.repeat(50);
    const highlighter = await createCodeHighlighter();
    const tokens = highlighter.codeToTokens(source, {
      lang: "typescript",
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    });
    expect(
      tokens.tokens.map((line) => line.map((token) => token.content).join("")).join("\n"),
    ).toBe(source);
    expect(
      tokens.tokens
        .flat()
        .some((token) => token.htmlStyle?.["--shiki-light"] !== token.htmlStyle?.["--shiki-dark"]),
    ).toBe(true);
  });
});
