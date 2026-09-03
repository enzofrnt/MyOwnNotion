import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { collectOperationalSyncPageIds } from "../src/services/operational-sync-pages.ts";

describe("collectOperationalSyncPageIds", () => {
  it("exchanges queued, leftover and open pages, never the idle visit cache", () => {
    const queued = generateUuidV7();
    const leftover = generateUuidV7();
    const open = generateUuidV7();
    const idleVisited = generateUuidV7();
    expect(collectOperationalSyncPageIds([queued], [leftover], [open, queued])).toEqual(
      [leftover, open, queued].sort(),
    );
    expect(collectOperationalSyncPageIds([queued], [leftover], [open])).not.toContain(idleVisited);
  });
});
