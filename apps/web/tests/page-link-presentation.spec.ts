import type { ProjectedItem } from "@myownnotion/client-core";
import type { Uuid } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  pageLinkStatePresentation,
  pageLinkTargetState,
} from "../src/features/editor/page-link.ts";

const targetId = "0193f4a8-7c2d-7b11-8a3e-1c9d4e6f2056" as Uuid;

function item(lifecycle: ProjectedItem["lifecycle"]): Pick<ProjectedItem, "id" | "lifecycle"> {
  return { id: targetId, lifecycle };
}

describe("page-link presentation", () => {
  it("distinguishes active, deleted, unavailable and invalid targets", () => {
    expect(pageLinkTargetState(targetId, [item("active")])).toBe("active");
    expect(pageLinkTargetState(targetId, [item("trashed")])).toBe("deleted");
    expect(pageLinkTargetState(targetId, [])).toBe("unavailable");
    expect(pageLinkTargetState("not-a-uuid", [])).toBe("unknown");
  });

  it("gives every non-active state a distinct class and accessible suffix", () => {
    expect(pageLinkStatePresentation("active")).toEqual({ className: "page-link", suffix: "" });
    for (const state of ["deleted", "unavailable", "unknown"] as const) {
      const presentation = pageLinkStatePresentation(state);
      expect(presentation.className).toContain(`page-link-${state}`);
      expect(presentation.suffix).not.toBe("");
    }
  });
});
