import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  commitWindowsProfileKey,
  WINDOWS_KEY_PRIME_SWITCH,
  WINDOWS_SESSION_DATA_SWITCH,
} from "../src/windows-profile-key.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "windows-profile-prime-"));
  directories.push(directory);
  const options = {
    executable: path.join(directory, "App with spaces.exe"),
    userData: directory,
    sessionData: directory,
  };
  const state = path.join(directory, "Local State");
  // Opaque fixture bytes only: the native child, not this parser, authenticates
  // the real OS key. No actual Windows key is exported into these unit tests.
  const metadata = JSON.stringify({
    os_crypt: { encrypted_key: Buffer.from("DPAPIopaque-fixture").toString("base64") },
    other: { retained: true },
  });
  return { directory, options, state, metadata };
}

describe("Windows native profile key commitment", () => {
  it("waits for successful native initialization and preserves the exact committed metadata", () => {
    const { directory, options, state, metadata } = fixture();
    const envelope = path.join(directory, "device-key.envelope");
    writeFileSync(envelope, "existing sealed envelope");
    const run = vi.fn(() => {
      writeFileSync(state, metadata);
      return { status: 0 };
    });
    commitWindowsProfileKey({ ...options, run });
    expect(run).toHaveBeenCalledWith(options.executable, [
      `--${WINDOWS_KEY_PRIME_SWITCH}`,
      `--user-data-dir=${directory}`,
      `--${WINDOWS_SESSION_DATA_SWITCH}=${directory}`,
    ]);
    expect(readFileSync(state, "utf8")).toBe(metadata);
    expect(readFileSync(envelope, "utf8")).toBe("existing sealed envelope");
    commitWindowsProfileKey({ ...options, run });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("passes the application directory as one argument for unpackaged Electron", () => {
    const { options, state, metadata, directory } = fixture();
    writeFileSync(state, metadata);
    const run = vi.fn(() => ({ status: 0 }));
    const applicationPath = path.join(directory, "development app");
    commitWindowsProfileKey({ ...options, applicationPath, run });
    expect(run).toHaveBeenCalledWith(options.executable, [
      applicationPath,
      `--${WINDOWS_KEY_PRIME_SWITCH}`,
      `--user-data-dir=${directory}`,
      `--${WINDOWS_SESSION_DATA_SWITCH}=${directory}`,
    ]);
  });

  it.each([{ status: 1 }, { status: null }, { status: 0, error: new Error("timeout") }])(
    "refuses failed native initialization even if old metadata exists: %j",
    (result) => {
      const { options, state, metadata } = fixture();
      writeFileSync(state, metadata);
      expect(() => commitWindowsProfileKey({ ...options, run: () => result })).toThrow(
        "initialization failed",
      );
      expect(readFileSync(state, "utf8")).toBe(metadata);
    },
  );

  it.each([
    null,
    "",
    "{broken",
    "{}",
    JSON.stringify({ os_crypt: { encrypted_key: "not base64" } }),
    JSON.stringify({ os_crypt: { encrypted_key: Buffer.from("foreign-key").toString("base64") } }),
    " ".repeat(4 * 1024 * 1024 + 1),
  ])("refuses absent or invalid committed metadata", (metadata) => {
    const { options, state } = fixture();
    if (metadata !== null) writeFileSync(state, metadata);
    expect(() => commitWindowsProfileKey({ ...options, run: () => ({ status: 0 }) })).toThrow();
  });

  it.each(["executable", "userData", "sessionData", "applicationPath"] as const)(
    "refuses a relative %s before launching",
    (name) => {
      const { options } = fixture();
      const run = vi.fn(() => ({ status: 0 }));
      expect(() => commitWindowsProfileKey({ ...options, [name]: "relative", run })).toThrow(
        "absolute",
      );
      expect(run).not.toHaveBeenCalled();
    },
  );
});
