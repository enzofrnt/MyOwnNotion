import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** codesign does not expand Xcode build variables in a supplied plist. */
export function materializeMacEntitlements(template: string, identity: string): string {
  const teamId = identity.match(/\(([A-Z0-9]{10})\)$/)?.[1];
  if (!teamId) throw new Error("The Apple signing identity must include its ten-character Team ID");
  const directory = mkdtempSync(path.join(tmpdir(), "myownnotion-entitlements-"));
  const target = path.join(directory, "desktop.plist");
  writeFileSync(
    target,
    readFileSync(template, "utf8").replaceAll("$(AppIdentifierPrefix)", `${teamId}.`),
    { mode: 0o600 },
  );
  return target;
}
