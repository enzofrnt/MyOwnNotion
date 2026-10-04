import { expect, it } from "vitest";
import { normaliseSearchText, safeSearchSnippet } from "../src/index.ts";

it("sanitizes snippets and preserves caller-supplied matching offsets", () => {
  expect(safeSearchSnippet("", [], "")).toBeNull();
  expect(safeSearchSnippet("\0\n\u200b", [], "")).toBeNull();
  expect(safeSearchSnippet("a\0  b\u200bc", [], "a b c")).toBe("a b c");
  const body = `${" ".repeat(250)}${"a".repeat(150)}target${"z".repeat(500)}`;
  const serverComparable = body.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
  expect(safeSearchSnippet(body, ["target"], serverComparable)).toBe(
    `…${"a".repeat(100)}target${"z".repeat(214)}…`,
  );
  // The local normalizer removes leading spaces; keep its historical offsets.
  expect(safeSearchSnippet(body, ["target"], normaliseSearchText(body))).toBe(
    `…${"a".repeat(120)}…`,
  );
  expect(safeSearchSnippet("hello", ["absent"], "hello")).toBe("hello");
});
