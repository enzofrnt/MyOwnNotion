import { describe, expect, it } from "vitest";
import { IPC_CHANNELS } from "../src/ipc-contract.ts";
import { validIpcPayload } from "../src/ipc-validation.ts";

describe("native IPC payload boundary", () => {
  it("rejects null, primitives, arbitrary paths, and unsupported fields", () => {
    for (const value of [
      null,
      true,
      [],
      3,
      "text",
      {},
      { serverUrl: "https://notes.example", shell: "sh" },
    ]) {
      expect(validIpcPayload(IPC_CHANNELS.setActiveProfile, value)).toBe(false);
    }
    expect(
      validIpcPayload(IPC_CHANNELS.saveFile, {
        defaultName: "../../data",
        bytes: new Uint8Array(),
      }),
    ).toBe(false);
    expect(validIpcPayload(IPC_CHANNELS.chooseFile, { path: "/etc/passwd" })).toBe(false);
    expect(validIpcPayload(IPC_CHANNELS.openExternal, null)).toBe(false);
  });
  it("allows only 256-bit key material and argument-free read operations", () => {
    expect(validIpcPayload(IPC_CHANNELS.wrapDeviceKey, new Uint8Array(32))).toBe(true);
    expect(validIpcPayload(IPC_CHANNELS.wrapDeviceKey, new Uint8Array(31))).toBe(false);
    expect(validIpcPayload(IPC_CHANNELS.getKeyState, undefined)).toBe(true);
    expect(validIpcPayload(IPC_CHANNELS.getKeyState, { profile: "other" })).toBe(false);
  });
  it("allows bounded file dialog choices and safe basenames", () => {
    expect(
      validIpcPayload(IPC_CHANNELS.chooseFile, {
        filters: [{ name: "Images", extensions: ["png", "jpg"] }],
      }),
    ).toBe(true);
    expect(
      validIpcPayload(IPC_CHANNELS.chooseFile, {
        filters: [{ name: "Images", extensions: ["../"] }],
      }),
    ).toBe(false);
    expect(
      validIpcPayload(IPC_CHANNELS.saveFile, {
        defaultName: "backup.zip",
        bytes: new Uint8Array(8),
      }),
    ).toBe(true);
  });
});
