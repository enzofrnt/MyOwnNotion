import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { protectFixtureKey } from "../../../scripts/e2e/private-fixture-key.ts";
import { checkDeploymentKey, loadDeploymentKey } from "../../api/src/security/deployment-key.ts";

function changeWindowsAcl(filename: string, change: "everyone" | "inheritance"): void {
  const result = spawnSync(
    path.join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
      $ErrorActionPreference = 'Stop'
      $acl = Get-Acl -LiteralPath $env:MYOWNNOTION_ACL_PATH
      if ($env:MYOWNNOTION_ACL_CHANGE -eq 'inheritance') {
        $acl.SetAccessRuleProtection($false, $true)
      } else {
        $everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow'))
      }
      Set-Acl -LiteralPath $env:MYOWNNOTION_ACL_PATH -AclObject $acl
    `,
    ],
    {
      env: { ...process.env, MYOWNNOTION_ACL_PATH: filename, MYOWNNOTION_ACL_CHANGE: change },
      windowsHide: true,
      encoding: "utf8",
      timeout: 10000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
}

it("invalidates a warmed native key permission verdict on ACL change, replacement and removal", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mon-native-key-"));
  const filename = path.join(root, "fixture key");
  try {
    const bytes = randomBytes(32);
    writeFileSync(filename, bytes.toString("base64"), { mode: 0o600 });
    protectFixtureKey(filename);
    expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(bytes);
    expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(bytes);
    if (process.platform === "win32") {
      const before = statSync(filename, { bigint: true });
      changeWindowsAcl(filename, "everyone");
      const after = statSync(filename, { bigint: true });
      // Native Bun must expose descriptor-only changes as ChangeTime, without
      // requiring a data write or relying on rounded millisecond timestamps.
      expect(after.ctimeNs).not.toBe(before.ctimeNs);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(after.ino).toBe(before.ino);
    } else chmodSync(filename, 0o644);
    expect(checkDeploymentKey(filename)).toEqual({ available: false, problem: "world-readable" });
    protectFixtureKey(filename);
    expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(bytes);
    if (process.platform === "win32") {
      const before = statSync(filename, { bigint: true });
      changeWindowsAcl(filename, "inheritance");
      expect(statSync(filename, { bigint: true }).ctimeNs).not.toBe(before.ctimeNs);
      expect(checkDeploymentKey(filename)).toEqual({ available: false, problem: "world-readable" });
      protectFixtureKey(filename);
      expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(bytes);
    }

    const replacement = path.join(root, "replacement key");
    const replacementBytes = randomBytes(32);
    writeFileSync(replacement, replacementBytes.toString("base64"), { mode: 0o600 });
    protectFixtureKey(replacement);
    const beforeReplacement = statSync(filename, { bigint: true });
    renameSync(filename, path.join(root, "retired key"));
    renameSync(replacement, filename);
    expect(statSync(filename, { bigint: true }).ino).not.toBe(beforeReplacement.ino);
    expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(replacementBytes);

    rmSync(filename);
    expect(checkDeploymentKey(filename)).toEqual({ available: false, problem: "missing" });
    writeFileSync(filename, bytes.toString("base64"), { mode: 0o644 });
    if (process.platform === "win32") changeWindowsAcl(filename, "everyone");
    expect(checkDeploymentKey(filename)).toEqual({ available: false, problem: "world-readable" });
    protectFixtureKey(filename);
    expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(bytes);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
