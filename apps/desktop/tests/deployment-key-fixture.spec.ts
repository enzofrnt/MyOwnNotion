import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { protectFixtureKey } from "../../../scripts/e2e/private-fixture-key.ts";
import { checkDeploymentKey, loadDeploymentKey } from "../../api/src/security/deployment-key.ts";

it("loads the native journey key only with a private platform permission boundary", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "mon-native-key-"));
  const filename = path.join(root, "fixture key");
  try {
    const bytes = randomBytes(32);
    writeFileSync(filename, bytes.toString("base64"), { mode: 0o600 });
    protectFixtureKey(filename);
    expect(Buffer.from(loadDeploymentKey(filename).bytes)).toEqual(bytes);
    if (process.platform === "win32") {
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
          $everyone = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
          $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($everyone, 'Read', 'Allow'))
          Set-Acl -LiteralPath $env:MYOWNNOTION_ACL_PATH -AclObject $acl
        `,
        ],
        {
          env: { ...process.env, MYOWNNOTION_ACL_PATH: filename },
          windowsHide: true,
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.status).toBe(0);
    } else chmodSync(filename, 0o644);
    expect(checkDeploymentKey(filename)).toEqual({ available: false, problem: "world-readable" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
