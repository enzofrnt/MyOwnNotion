import {
  generateUuidV7,
  isProtectedContentPayload,
  normalizeDisplayName,
  normalizeItemIcon,
  PROTECTED_CONTENT_PAYLOAD,
  parseMutationCommand,
  validateItemIcon,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { MemoryGraph } from "./helpers/memory-view.ts";

describe("canonical display name", () => {
  it("keeps the existing display-name upper bound explicit", () => {
    expect(normalizeDisplayName("x".repeat(513))).toMatchObject({
      ok: false,
      error: { code: "validation.invalid-name" },
    });
  });

  it.each(["\uFFFD", "  \uFFFD  "])(
    "reserves the exact protected-content placeholder: %j",
    (input) => {
      expect(normalizeDisplayName(input)).toMatchObject({
        ok: false,
        error: { code: "validation.invalid-name" },
      });
    },
  );

  it("allows the replacement character inside a longer authored name", () => {
    expect(normalizeDisplayName("Draft \uFFFD note")).toEqual({
      ok: true,
      value: "Draft \uFFFD note",
    });
  });
});

describe("protected content payload marker", () => {
  it("accepts only the exact marker object", () => {
    expect(isProtectedContentPayload(PROTECTED_CONTENT_PAYLOAD)).toBe(true);
    expect(isProtectedContentPayload({ ...PROTECTED_CONTENT_PAYLOAD, extra: true })).toBe(false);
  });

  it("rejects symbol and non-enumerable keys hidden from Object.keys", () => {
    const symbolKey = Symbol("extra");
    const withSymbol = { ...PROTECTED_CONTENT_PAYLOAD, [symbolKey]: true };
    const withNonEnumerable = { ...PROTECTED_CONTENT_PAYLOAD };
    Object.defineProperty(withNonEnumerable, "extra", {
      configurable: true,
      enumerable: false,
      value: true,
    });

    expect(isProtectedContentPayload(withSymbol)).toBe(false);
    expect(isProtectedContentPayload(withNonEnumerable)).toBe(false);
  });
});

describe("canonical item icon", () => {
  it.each([
    ["🗂️", "🗂️"],
    ["  🧑🏽‍💻  ", "🧑🏽‍💻"],
    ["🇫🇷", "🇫🇷"],
    ["1️⃣", "1️⃣"],
    [null, null],
  ] as const)("normalizes one Unicode emoji grapheme: %s", (input, expected) => {
    expect(normalizeItemIcon(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "  ", "A", "notes", "😀😀", "🇫", "1", "#"])(
    "rejects a non-emoji or more than one grapheme: %s",
    (input) => {
      const result = normalizeItemIcon(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("validation.invalid-icon");
      }
    },
  );

  it("allows page and folder icons, including explicit removal", () => {
    const graph = new MemoryGraph();
    for (const kind of ["page", "folder"] as const) {
      const itemId = graph.addItem(kind, kind);
      expect(validateItemIcon(graph, { itemId, icon: "📚" })).toMatchObject({
        ok: true,
        value: { icon: "📚" },
      });
      expect(validateItemIcon(graph, { itemId, icon: null })).toMatchObject({
        ok: true,
        value: { icon: null },
      });
    }
  });

  it("refuses an icon on a file", () => {
    const graph = new MemoryGraph();
    const itemId = graph.addItem("file", "archive.zip");
    const result = validateItemIcon(graph, { itemId, icon: "📦" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("item.wrong-kind");
    }
  });

  it("refuses icon changes for missing or inactive items", () => {
    const graph = new MemoryGraph();
    expect(validateItemIcon(graph, { itemId: generateUuidV7(), icon: "📌" })).toMatchObject({
      ok: false,
      error: { code: "item.not-found" },
    });
    const trashedId = graph.addItem("page", "Trashed", "trashed");
    expect(validateItemIcon(graph, { itemId: trashedId, icon: "📌" })).toMatchObject({
      ok: false,
      error: { code: "item.not-active" },
    });
  });

  it("parses icon creation and idempotent icon changes", () => {
    const itemId = generateUuidV7();
    const created = parseMutationCommand("item.create", {
      id: itemId,
      kind: "page",
      name: "Roadmap",
      icon: "🛣️",
      placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
    });
    expect(created).toMatchObject({ ok: true, value: { icon: "🛣️" } });

    expect(parseMutationCommand("item.icon", { itemId, icon: "📍" })).toMatchObject({
      ok: true,
      value: { type: "item.icon", itemId, icon: "📍" },
    });
    expect(parseMutationCommand("item.icon", { itemId, icon: null })).toMatchObject({
      ok: true,
      value: { type: "item.icon", itemId, icon: null },
    });
    expect(parseMutationCommand("item.icon", { itemId, icon: "two emoji 😀😀" }).ok).toBe(false);
  });
});
