import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "../src/services/storage-manager.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("persistent browser storage", () => {
  it("does not hold workspace startup when the browser leaves the permission request unsettled", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", {
      storage: {
        persisted: () => new Promise<boolean>(() => {}),
        persist,
      },
    });

    const result = requestPersistentStorage(25);
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports the browser persistence decision when it settles", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", {
      storage: {
        persisted: async () => false,
        persist,
      },
    });

    await expect(requestPersistentStorage(25)).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });
});
