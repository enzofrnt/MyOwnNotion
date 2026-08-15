/**
 * What a conversion allows and what it refuses (T013, T014, US1, US2).
 *
 * These tests are the whole justification for `item.convert` existing as a
 * named operation rather than as a field update. Every refusal below happens
 * in the domain, which means it happens for every caller — a script, a direct
 * API call during testing, a mobile client nobody has written yet. Move these
 * rules into a screen and each one becomes a promise that screen makes.
 *
 * The transition table is exercised exhaustively rather than by example,
 * because "which conversions are allowed" is a small closed question and
 * leaving any cell untested is leaving it undecided.
 */

import { describe, expect, it } from "vitest";
import {
  type CanonicalItem,
  conversionCanDestroy,
  generateUuidV7,
  type ItemKind,
  planConversion,
} from "../src/index.ts";

function item(kind: ItemKind, lifecycle: CanonicalItem["lifecycle"] = "active"): CanonicalItem {
  return {
    id: generateUuidV7(),
    workspaceId: generateUuidV7(),
    kind,
    name: "Thing",
    lifecycle,
    trashedAt: null,
    purgeAfter: null,
    currentRevisionId: generateUuidV7(),
  };
}

describe("the transition table", () => {
  it("allows folder to page, with nothing to confirm", () => {
    const result = planConversion(
      item("folder"),
      { itemId: generateUuidV7(), targetKind: "page" },
      false,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.destroysContent).toBe(false);
    expect(result.ok && result.value.noop).toBe(false);
  });

  it("allows page to folder when the page holds nothing", () => {
    // Nothing is destroyed, so nothing needs confirming. Demanding one here
    // would teach an owner to dismiss the warning that matters.
    const result = planConversion(
      item("page"),
      { itemId: generateUuidV7(), targetKind: "folder" },
      false,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.destroysContent).toBe(false);
  });

  it("allows page to folder with content when confirmed", () => {
    const result = planConversion(
      item("page"),
      { itemId: generateUuidV7(), targetKind: "folder", confirmedDestruction: true },
      true,
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.destroysContent).toBe(true);
  });

  it.each([
    ["page", "page"],
    ["folder", "folder"],
  ] as const)("treats %s to %s as a no-op rather than an error", (from, to) => {
    // A replayed offline command must succeed quietly. Failing here would make
    // a retry after a restart look like a broken conversion.
    const result = planConversion(item(from), { itemId: generateUuidV7(), targetKind: to }, true);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.noop).toBe(true);
    expect(result.ok && result.value.destroysContent).toBe(false);
  });

  it("refuses to convert a file", () => {
    const result = planConversion(
      item("file"),
      { itemId: generateUuidV7(), targetKind: "page" },
      false,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("conversion.file-not-convertible");
  });

  it("refuses to convert anything into a file", () => {
    const result = planConversion(
      item("page"),
      { itemId: generateUuidV7(), targetKind: "file" as never },
      false,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("conversion.file-not-convertible");
  });
});

describe("the destructive direction", () => {
  it("is refused when the page holds content and nothing was confirmed", () => {
    // FR-010 and FR-014 together. This refusal is the reason the operation is
    // named rather than a field update: there would be nowhere else to put it
    // that a caller could not skip.
    const result = planConversion(
      item("page"),
      { itemId: generateUuidV7(), targetKind: "folder" },
      true,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("conversion.confirmation-required");
  });

  it("is refused when confirmation is explicitly false", () => {
    const result = planConversion(
      item("page"),
      { itemId: generateUuidV7(), targetKind: "folder", confirmedDestruction: false },
      true,
    );
    expect(result.ok).toBe(false);
  });

  it("does not accept confirmation as a reason to destroy nothing", () => {
    // Confirming is permission, not an instruction. An empty page converted
    // with a confirmation still destroys nothing.
    const result = planConversion(
      item("page"),
      { itemId: generateUuidV7(), targetKind: "folder", confirmedDestruction: true },
      false,
    );
    expect(result.ok && result.value.destroysContent).toBe(false);
  });
});

describe("items that cannot be converted at all", () => {
  it("refuses an item that does not exist", () => {
    const result = planConversion(null, { itemId: generateUuidV7(), targetKind: "page" }, false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("item.not-found");
  });

  it.each(["trashed", "purged"] as const)("refuses a %s item", (lifecycle) => {
    const result = planConversion(
      item("folder", lifecycle),
      { itemId: generateUuidV7(), targetKind: "page" },
      false,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("item.not-active");
  });
});

describe("conversionCanDestroy", () => {
  it("is true only for page to folder", () => {
    expect(conversionCanDestroy("page", "folder")).toBe(true);
    expect(conversionCanDestroy("folder", "page")).toBe(false);
    expect(conversionCanDestroy("page", "page")).toBe(false);
    expect(conversionCanDestroy("folder", "folder")).toBe(false);
  });
});
