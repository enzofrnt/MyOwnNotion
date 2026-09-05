import { spawnSync } from "node:child_process";
import { type BigIntStats, statSync } from "node:fs";
import path from "node:path";

type KeyFileStat = Pick<
  BigIntStats,
  "isFile" | "dev" | "ino" | "ctimeNs" | "mtimeNs" | "birthtimeNs" | "size"
>;

function fileIdentity(stats: KeyFileStat): string | null {
  if (!stats.isFile()) return null;
  const values = [
    stats.dev,
    stats.ino,
    stats.ctimeNs,
    stats.mtimeNs,
    stats.birthtimeNs,
    stats.size,
  ];
  if (
    values.some((value) => typeof value !== "bigint" || value < 0n) ||
    stats.ino === 0n ||
    stats.ctimeNs === 0n ||
    stats.mtimeNs === 0n ||
    stats.birthtimeNs === 0n
  )
    return null;
  return values.join(":");
}

/**
 * Cache only positive descriptor verdicts for at most eight exact file identities.
 * Bun 1.4's Windows stat uses libuv ChangeTime for ctimeNs; security descriptor
 * changes update that stamp. Both cold inspections and warm hits recheck metadata.
 * Key bytes are deliberately outside this cache and are still read by the loader.
 */
export class WindowsKeyAclVerifier {
  private readonly verified = new Map<string, string>();
  private readonly inspect: (filename: string) => boolean;
  private readonly readStat: (filename: string) => KeyFileStat;

  constructor(
    deps: {
      readonly inspect?: (filename: string) => boolean;
      readonly readStat?: (filename: string) => KeyFileStat;
    } = {},
  ) {
    this.inspect = deps.inspect ?? hasPrivateWindowsKeyAcl;
    this.readStat = deps.readStat ?? ((filename) => statSync(filename, { bigint: true }));
  }

  invalidate(filename: string): void {
    this.verified.delete(path.resolve(filename));
  }

  hasPrivateAcl(filename: string): boolean {
    const absolute = path.resolve(filename);
    try {
      const before = fileIdentity(this.readStat(absolute));
      if (before === null) {
        this.verified.delete(absolute);
        return false;
      }
      const cached = this.verified.get(absolute) === before;
      // Do not retain a stale verdict if a fresh inspection fails or races.
      this.verified.delete(absolute);
      if (!cached && !this.inspect(absolute)) return false;
      if (fileIdentity(this.readStat(absolute)) !== before) return false;
      this.verified.set(absolute, before);
      if (this.verified.size > 8) {
        for (const oldest of this.verified.keys()) {
          this.verified.delete(oldest);
          break;
        }
      }
      return true;
    } catch {
      this.verified.delete(absolute);
      return false;
    }
  }
}

const cachedWindowsKeyAcl = new WindowsKeyAclVerifier();

export function hasCachedPrivateWindowsKeyAcl(filename: string): boolean {
  return cachedWindowsKeyAcl.hasPrivateAcl(filename);
}

export function forgetCachedWindowsKeyAcl(filename: string): void {
  cachedWindowsKeyAcl.invalidate(filename);
}

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
