import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileProfileStore, persistUpsert } from "../src/profile-store.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("profile IPC contract", () => {
  it("persists a normalized origin and never stores a token", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-profile-"));
    dirs.push(dir);
    const store = new FileProfileStore(path.join(dir, "profiles.json"));
    const mutation = persistUpsert(store, { serverUrl: "https://notes.example.org/" });
    expect(mutation.result.ok).toBe(true);
    if (!mutation.result.ok) {
      return;
    }
    expect(mutation.result.profile.serverUrl).toBe("https://notes.example.org");
    expect(JSON.stringify(store.loadAll())).not.toMatch(/token|secret|cookie/i);
  });

  it("does not reuse a device identity when the origin changes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-profile-"));
    dirs.push(dir);
    const store = new FileProfileStore(path.join(dir, "profiles.json"));
    persistUpsert(store, { serverUrl: "https://a.example.org" });
    const first = store.loadAll()[0];
    if (first === undefined) {
      throw new Error("missing profile");
    }
    store.saveAll([{ ...first, deviceId: "device-1" }]);
    const second = persistUpsert(store, { serverUrl: "https://b.example.org" });
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) {
      return;
    }
    expect(second.result.profile.deviceId).toBeNull();
  });
});

it.each(["{truncated", '[{"profileId":"damaged"}]'])(
  "preserves a damaged registry instead of replacing the vault's identity: %s",
  (contents) => {
    const dir = mkdtempSync(path.join(tmpdir(), "desktop-profile-recovery-"));
    dirs.push(dir);
    const file = path.join(dir, "profiles.json");
    writeFileSync(file, contents);
    expect(() =>
      persistUpsert(new FileProfileStore(file), { serverUrl: "https://notes.example.org" }),
    ).toThrow();
    expect(readFileSync(file, "utf8")).toBe(contents);
  },
);
