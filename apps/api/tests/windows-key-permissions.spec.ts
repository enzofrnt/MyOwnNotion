import { describe, expect, it, vi } from "vitest";

const processResult = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: processResult }));

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
