import type { ProjectedItem } from "@myownnotion/client-core";
import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it, vi } from "vitest";
import { resolveLocalPageLinkTarget } from "../src/features/hierarchy/page-link-target.ts";

describe("internal page navigation after local creation", () => {
  it("opens a committed child even while the rendered tree has not received its projection", async () => {
    const id = generateUuidV7();
    const committed = { id, lifecycle: "active" } as ProjectedItem;
    let resolveRead!: (item: ProjectedItem) => void;
    const readItem = vi.fn(
      () =>
        new Promise<ProjectedItem>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const opening = resolveLocalPageLinkTarget(id, readItem);
    expect(readItem).toHaveBeenCalledWith(id);
    resolveRead(committed);
    expect(await opening).toEqual({ ok: true, itemId: id });
  });

  it("refuses a target that has entered the trash even if an older tree still displayed it", async () => {
    const id = generateUuidV7();
    const result = await resolveLocalPageLinkTarget(
      id,
      async () => ({ id, lifecycle: "trashed" }) as ProjectedItem,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "item.not-active" } });
  });

  it("rejects invalid identities before reading and reports unavailable local targets safely", async () => {
    const readItem = vi.fn(async () => null);
    expect(await resolveLocalPageLinkTarget("invalid", readItem)).toMatchObject({
      ok: false,
      error: { code: "validation.invalid-identifier" },
    });
    expect(readItem).not.toHaveBeenCalled();
    expect(await resolveLocalPageLinkTarget(generateUuidV7(), readItem)).toMatchObject({
      ok: false,
      error: { code: "item.not-found" },
    });
    const failure = await resolveLocalPageLinkTarget(generateUuidV7(), async () => {
      throw new Error("private local record");
    });
    expect(failure).toMatchObject({ ok: false, error: { code: "item.not-found" } });
    expect(JSON.stringify(failure)).not.toContain("private local record");
  });
});
