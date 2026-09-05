import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import path from "node:path";
import { hasPrivateWindowsKeyAcl } from "../../apps/api/src/security/windows-key-permissions.ts";

/** Only the newly generated disposable fixture key is changed. */
export function protectFixtureKey(filename: string): void {
  if (process.platform !== "win32") {
    chmodSync(filename, 0o600);
    return;
  }
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
      $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
      $acl = [System.Security.AccessControl.FileSecurity]::new()
      $acl.SetOwner($sid)
      $acl.SetAccessRuleProtection($true, $false)
      $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
      Set-Acl -LiteralPath $env:MYOWNNOTION_ACL_PATH -AclObject $acl
    `,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 65536,
      env: { ...process.env, MYOWNNOTION_ACL_PATH: filename },
    },
  );
  if (result.error !== undefined || result.status !== 0 || !hasPrivateWindowsKeyAcl(filename))
    throw new Error("The native journey deployment key could not be restricted to its owner.");
}
