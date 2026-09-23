import { spawnSync } from "node:child_process";
import { chmodSync } from "node:fs";
import {
  hasPrivateWindowsKeyAcl,
  resolveWindowsPowerShellExecutable,
  WINDOWS_ACL_POWERSHELL_TIMEOUT_MS,
} from "../../apps/api/src/security/windows-key-permissions.ts";

/** Only the newly generated disposable fixture key is changed. */
export function protectFixtureKey(filename: string): void {
  if (process.platform !== "win32") {
    chmodSync(filename, 0o600);
    return;
  }
  const result = spawnSync(
    resolveWindowsPowerShellExecutable(),
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
      timeout: WINDOWS_ACL_POWERSHELL_TIMEOUT_MS,
      maxBuffer: 65536,
      env: { ...process.env, MYOWNNOTION_ACL_PATH: filename },
    },
  );
  if (result.error !== undefined || result.status !== 0 || !hasPrivateWindowsKeyAcl(filename)) {
    const detail = [
      result.error?.message,
      result.status === null ? undefined : `status=${result.status}`,
      result.stderr?.trim() || undefined,
    ]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join("; ");
    throw new Error(
      detail.length === 0
        ? "The native journey deployment key could not be restricted to its owner."
        : `The native journey deployment key could not be restricted to its owner (${detail}).`,
    );
  }
}
