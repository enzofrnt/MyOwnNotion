// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  BROWSER_DEVICE_IDENTITY_STORAGE_KEY,
  BrowserDeviceIdentityStore,
} from "../src/features/auth/browser-device-identity.ts";

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

const UUIDS = [
  "39a88270-225f-4ec4-9548-aebfa39fb55e",
  "f66efccd-ac83-46d4-bde9-24e2dbd36eba",
] as const;

function store(storage: Storage, uuid = UUIDS[0]): BrowserDeviceIdentityStore {
  return new BrowserDeviceIdentityStore({
    storage: () => storage,
    randomUuid: () => uuid,
    browserName: () => "Chromium",
    platformName: () => "macOS",
  });
}

describe("the browser device identity", () => {
  it("is stable across tabs sharing one origin store", () => {
    const storage = new MemoryStorage();
    const firstTab = store(storage, UUIDS[0]).getOrCreate();
    const secondTab = store(storage, UUIDS[1]).getOrCreate();

    expect(secondTab).toEqual(firstTab);
    expect(firstTab).toEqual({
      deviceBindingId: `web-${UUIDS[0]}`,
      name: "Chromium on macOS",
      platform: "macOS",
    });
  });

  it("gives isolated profiles distinct identities", () => {
    const profileA = store(new MemoryStorage(), UUIDS[0]).getOrCreate();
    const profileB = store(new MemoryStorage(), UUIDS[1]).getOrCreate();

    expect(profileB.deviceBindingId).not.toBe(profileA.deviceBindingId);
  });

  it("replaces malformed persisted metadata instead of sending it to authentication", () => {
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_DEVICE_IDENTITY_STORAGE_KEY, "not-json");

    expect(store(storage).getOrCreate().deviceBindingId).toBe(`web-${UUIDS[0]}`);
    expect(
      JSON.parse(storage.getItem(BROWSER_DEVICE_IDENTITY_STORAGE_KEY) ?? "null"),
    ).toMatchObject({ version: 1, deviceBindingId: `web-${UUIDS[0]}` });
  });

  it("keeps one in-memory identity when origin storage is unavailable", () => {
    const unavailable = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as Storage;
    const identity = store(unavailable);

    expect(identity.getOrCreate()).toEqual(identity.getOrCreate());
  });
});
