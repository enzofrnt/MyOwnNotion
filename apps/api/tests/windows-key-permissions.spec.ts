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
      processResult.mockReturnValue({ status: 0, stdout: JSON.stringify(valid) });
      expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(Buffer.alloc(32, 17));
      processResult.mockReturnValue({
        status: 0,
        stdout: JSON.stringify({ ...valid, protected: false }),
      });
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
