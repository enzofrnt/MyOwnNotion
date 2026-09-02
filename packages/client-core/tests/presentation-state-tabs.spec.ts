/**
 * Open tabs are device ergonomics (spec 022, FR-016/FR-017). The strip must
 * survive a stale or partial IndexedDB value and must never leak into revisions.
 */

import {
  closeTab,
  DEFAULT_WORKSPACE_PRESENTATION_STATE,
  GRAPH_TAB_ID,
  neighbourTab,
  normalizeWorkspacePresentationState,
  openTab,
  pruneTabs,
} from "@myownnotion/client-core";
import { describe, expect, it } from "vitest";

describe("open tab ids in the presentation state", () => {
  it("defaults to an empty strip and tolerates legacy records without the field", () => {
    expect(DEFAULT_WORKSPACE_PRESENTATION_STATE.openTabIds).toEqual([]);
    expect(normalizeWorkspacePresentationState({ sidebarOpen: false }).openTabIds).toEqual([]);
  });

  it("keeps only string ids, once each, in strip order", () => {
    const state = normalizeWorkspacePresentationState({
      openTabIds: ["a", 3, "b", null, "a", "c"],
    });
    expect(state.openTabIds).toEqual(["a", "b", "c"]);
  });

  it("puts a newly opened tab first and returns the same strip for an open tab", () => {
    const strip = ["a", "b"];
    expect(openTab(strip, "c")).toEqual(["c", "a", "b"]);
    expect(openTab(strip, "a")).toBe(strip);
    expect(closeTab(strip, "zzz")).toBe(strip);
  });

  it("closes a tab and names the neighbour that takes over", () => {
    expect(closeTab(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(neighbourTab(["a", "b", "c"], "b")).toBe("c");
    expect(neighbourTab(["a", "b", "c"], "c")).toBe("b");
    expect(neighbourTab(["a"], "a")).toBeNull();
    expect(neighbourTab(["a"], "zzz")).toBeNull();
  });

  it("prunes tabs whose item can no longer be opened", () => {
    expect(pruneTabs(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["a", "c"]);
    const intact = ["a"];
    expect(pruneTabs(intact, new Set(["a"]))).toBe(intact);
  });

  it("keeps the graph view tab when item identities are pruned", () => {
    expect(pruneTabs([GRAPH_TAB_ID, "a", "b"], new Set(["a"]))).toEqual([GRAPH_TAB_ID, "a"]);
    expect(openTab(["a"], GRAPH_TAB_ID)).toEqual([GRAPH_TAB_ID, "a"]);
  });
});
