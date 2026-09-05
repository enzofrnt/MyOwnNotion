import { describe, expect, it } from "vitest";
import { nextUpdatePhase } from "../src/update-state.ts";

describe("update state machine", () => {
  const safe = { pendingLocalChanges: false, migrationActive: false, ownerConfirmedInstall: true };
  const blocked = {
    pendingLocalChanges: true,
    migrationActive: false,
    ownerConfirmedInstall: false,
  };

  it("walks available → deferred → downloaded → installing", () => {
    let phase = nextUpdatePhase("idle", "check", safe);
    phase = nextUpdatePhase(phase, "found", safe);
    expect(phase).toBe("available");
    phase = nextUpdatePhase(phase, "defer", safe);
    expect(phase).toBe("deferred");
    phase = nextUpdatePhase(phase, "download", safe);
    phase = nextUpdatePhase(phase, "downloaded", safe);
    phase = nextUpdatePhase(phase, "install", safe);
    expect(phase).toBe("installing");
  });

  it("refuses to install while the outbox is unsafe", () => {
    expect(nextUpdatePhase("downloaded", "install", blocked)).toBe("downloaded");
  });
});
