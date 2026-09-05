import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const processResult = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: processResult }));

import { checkDeploymentKey, loadDeploymentKey } from "../src/security/deployment-key.ts";
import {
  hasPrivateWindowsKeyAcl,
  isPrivateWindowsKeyAcl,
  WindowsKeyAclVerifier,
} from "../src/security/windows-key-permissions.ts";

const valid = {
  currentSid: "S-1-5-21-123",
  ownerSid: "S-1-5-21-123",
  protected: true,
  rules: [{ sid: "S-1-5-21-123", type: "Allow" }],
};
describe("Windows deployment key ACL validation", () => {
  it("selects ACL enforcement in the real loader and refuses an unverified descriptor", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "mon-acl-loader-"));
    const filename = path.join(root, "fixture");
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    if (platform === undefined) throw new Error("Missing platform descriptor");
    try {
      writeFileSync(filename, Buffer.alloc(32, 17).toString("base64"), { mode: 0o600 });
      Object.defineProperty(process, "platform", { value: "win32" });
      processResult.mockClear();
      processResult.mockReturnValue({ status: 0, stdout: JSON.stringify(valid) });
      expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(Buffer.alloc(32, 17));
      expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(Buffer.alloc(32, 17));
      expect(processResult).toHaveBeenCalledTimes(1);
      // Content remains fresh even when the owner-only verdict was cached.
      writeFileSync(filename, `${Buffer.alloc(32, 18).toString("base64")}\n`);
      expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(Buffer.alloc(32, 18));
      expect(processResult).toHaveBeenCalledTimes(2);
      processResult.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ ...valid, protected: false }),
      });
      // This host fixture simulates the changed metadata accompanying Set-Acl.
      writeFileSync(filename, `${Buffer.alloc(32, 18).toString("base64")}\n\n`);
      expect(checkDeploymentKey(filename)).toEqual({ available: false, problem: "world-readable" });
      expect(() => loadDeploymentKey(filename)).toThrow("Windows ACL");
    } finally {
      Object.defineProperty(process, "platform", platform);
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("requires the current owner, protected inheritance and owner-only allow rules", () => {
    expect(isPrivateWindowsKeyAcl(valid)).toBe(true);
    expect(
      isPrivateWindowsKeyAcl({
        ...valid,
        rules: [...valid.rules, { sid: "S-1-1-0", type: "Deny" }],
      }),
    ).toBe(true);
    for (const value of [
      null,
      false,
      {},
      { ...valid, currentSid: "" },
      { ...valid, ownerSid: "another" },
      { ...valid, protected: false },
      { ...valid, rules: null },
      { ...valid, rules: [] },
      { ...valid, rules: [null] },
      { ...valid, rules: [{ type: "Allow" }] },
      { ...valid, rules: [{ sid: valid.currentSid, type: "unknown" }] },
      { ...valid, rules: [...valid.rules, { sid: "S-1-1-0", type: "Allow" }] },
    ])
      expect(isPrivateWindowsKeyAcl(value)).toBe(false);
  });
  it("fails closed on unavailable or malformed ACL inspection and passes the path as data", () => {
    for (const result of [
      { error: new Error("unavailable"), status: null },
      { status: 1 },
      { status: 0, stdout: "invalid JSON" },
      { status: 0, stdout: "null" },
    ]) {
      processResult.mockReturnValue(result);
      expect(hasPrivateWindowsKeyAcl("C:\\fixture\\private key")).toBe(false);
    }
    processResult.mockReturnValue({ status: 0, stdout: JSON.stringify(valid) });
    expect(hasPrivateWindowsKeyAcl("C:\\fixture\\private key")).toBe(true);
    const call = processResult.mock.calls.at(-1);
    expect(call?.[1].join(" ")).not.toContain("C:\\fixture\\private key");
    expect(call?.[2]).toMatchObject({
      windowsHide: true,
      timeout: 10000,
      env: { MYOWNNOTION_ACL_PATH: "C:\\fixture\\private key" },
    });
  });
});

function identity() {
  return {
    dev: 1n,
    ino: 2n,
    ctimeNs: 3n,
    mtimeNs: 4n,
    birthtimeNs: 5n,
    size: 44n,
    isFile: () => true,
  };
}

describe("Windows ACL positive cache", () => {
  it("reuses an unchanged positive verdict and reads metadata on both sides of every lookup", () => {
    const inspect = vi.fn(() => true);
    const readStat = vi.fn(identity);
    const verifier = new WindowsKeyAclVerifier({ inspect, readStat });
    for (let index = 0; index < 20; index++) expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(readStat).toHaveBeenCalledTimes(40);
    verifier.invalidate("fixture");
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it.each(["dev", "ino", "ctimeNs", "mtimeNs", "birthtimeNs", "size"] as const)(
    "revalidates immediately when %s changes, even by one nanosecond",
    (field) => {
      let stats = identity();
      const inspect = vi.fn(() => true);
      const verifier = new WindowsKeyAclVerifier({ inspect, readStat: () => stats });
      expect(verifier.hasPrivateAcl("fixture")).toBe(true);
      stats = { ...stats, [field]: stats[field] + 1n };
      inspect.mockReturnValue(false);
      expect(verifier.hasPrivateAcl("fixture")).toBe(false);
      expect(inspect).toHaveBeenCalledTimes(2);
      inspect.mockReturnValue(true);
      expect(verifier.hasPrivateAcl("fixture")).toBe(true);
      expect(inspect).toHaveBeenCalledTimes(3);
    },
  );

  it("refuses and invalidates a warmed verdict after owner or ACL changes", () => {
    let stats = identity();
    let descriptor = valid;
    const inspect = vi.fn(() => isPrivateWindowsKeyAcl(descriptor));
    const verifier = new WindowsKeyAclVerifier({ inspect, readStat: () => stats });
    for (const denied of [
      { ...valid, ownerSid: "S-1-5-21-another-owner" },
      { ...valid, rules: [...valid.rules, { sid: "S-1-1-0", type: "Allow" }] },
    ]) {
      descriptor = valid;
      expect(verifier.hasPrivateAcl("fixture")).toBe(true);
      stats = { ...stats, ctimeNs: stats.ctimeNs + 1n };
      descriptor = denied;
      expect(verifier.hasPrivateAcl("fixture")).toBe(false);
      descriptor = valid;
      stats = { ...stats, ctimeNs: stats.ctimeNs + 1n };
      expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    }
    expect(inspect).toHaveBeenCalledTimes(5);
  });

  it("does not retain a negative or failed inspection", () => {
    const inspect = vi.fn(() => false);
    const verifier = new WindowsKeyAclVerifier({ inspect, readStat: identity });
    expect(verifier.hasPrivateAcl("fixture")).toBe(false);
    inspect.mockImplementationOnce(() => {
      throw new Error("inspection failed");
    });
    expect(verifier.hasPrivateAcl("fixture")).toBe(false);
    inspect.mockReturnValue(true);
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it("refuses missing files and incomplete metadata and discards the prior cached identity", () => {
    let stats = identity();
    const inspect = vi.fn(() => true);
    const readStat = vi.fn(() => stats);
    const verifier = new WindowsKeyAclVerifier({ inspect, readStat });
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    readStat.mockImplementationOnce(() => {
      throw new Error("missing file");
    });
    expect(verifier.hasPrivateAcl("fixture")).toBe(false);
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
    for (const changed of [
      { ...identity(), ctimeNs: undefined },
      { ...identity(), ctimeNs: 3 },
      { ...identity(), ctimeNs: 0n },
      { ...identity(), ino: 0n },
      { ...identity(), size: -1n },
      { ...identity(), isFile: () => false },
    ]) {
      stats = changed as ReturnType<typeof identity>;
      expect(verifier.hasPrivateAcl("fixture")).toBe(false);
    }
    expect(inspect).toHaveBeenCalledTimes(2);
    stats = identity();
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("refuses identity races before and after a cached=%s lookup", (warm) => {
    const inspect = vi.fn(() => true);
    const readStat = vi.fn(identity);
    const verifier = new WindowsKeyAclVerifier({ inspect, readStat });
    if (warm) expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    readStat.mockReturnValueOnce(identity()).mockReturnValueOnce({ ...identity(), ctimeNs: 99n });
    expect(verifier.hasPrivateAcl("fixture")).toBe(false);
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
    readStat.mockReturnValueOnce(identity()).mockImplementationOnce(() => {
      throw new Error("disappeared after inspection");
    });
    expect(verifier.hasPrivateAcl("fixture")).toBe(false);
    expect(verifier.hasPrivateAcl("fixture")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it("retains at most eight positive entries and evicts the least recently checked path", () => {
    const inspect = vi.fn(() => true);
    const verifier = new WindowsKeyAclVerifier({ inspect, readStat: identity });
    for (let index = 0; index < 8; index++)
      expect(verifier.hasPrivateAcl(`key-${index}`)).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(8);
    expect(verifier.hasPrivateAcl("key-0")).toBe(true);
    expect(verifier.hasPrivateAcl("key-8")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(9);
    expect(verifier.hasPrivateAcl("key-0")).toBe(true);
    expect(verifier.hasPrivateAcl("key-2")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(9);
    expect(verifier.hasPrivateAcl("key-1")).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(10);
  });
});
