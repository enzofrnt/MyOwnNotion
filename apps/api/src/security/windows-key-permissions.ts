import { spawnSync } from "node:child_process";
import path from "node:path";

export function isPrivateWindowsKeyAcl(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const acl = value as Record<string, unknown>;
  if (
    typeof acl["currentSid"] !== "string" ||
    acl["currentSid"] === "" ||
    acl["ownerSid"] !== acl["currentSid"] ||
    acl["protected"] !== true ||
    !Array.isArray(acl["rules"])
  )
    return false;
  let allowed = false;
  for (const value of acl["rules"]) {
    if (value === null || typeof value !== "object") return false;
    const rule = value as Record<string, unknown>;
    if (typeof rule["sid"] !== "string" || (rule["type"] !== "Allow" && rule["type"] !== "Deny"))
      return false;
    if (rule["type"] === "Allow") {
      if (rule["sid"] !== acl["currentSid"]) return false;
      allowed = true;
    }
  }
  return allowed;
}

/** Query only the descriptor; key bytes never enter a child process or its output. */
export function hasPrivateWindowsKeyAcl(filename: string): boolean {
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
      $sidType = [System.Security.Principal.SecurityIdentifier]
      $rules = @($acl.GetAccessRules($true, $true, $sidType) | ForEach-Object {
        @{ sid = $_.IdentityReference.Value; type = $_.AccessControlType.ToString() }
      })
      @{ currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
         ownerSid = $acl.GetOwner($sidType).Value; protected = $acl.AreAccessRulesProtected;
         rules = $rules } | ConvertTo-Json -Compress -Depth 4
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
  if (result.error !== undefined || result.status !== 0) return false;
  try {
    return isPrivateWindowsKeyAcl(JSON.parse(result.stdout));
  } catch {
    return false;
  }
}
