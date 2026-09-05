import { spawnSync } from "node:child_process";

export type CodesignIdentityStatus =
  | { readonly kind: "ready"; readonly identityLine: string; readonly identityName: string }
  | { readonly kind: "cert-without-private-key"; readonly certificateSubject: string }
  | { readonly kind: "missing" };

function parseIdentityName(identityLine: string): string | null {
  const quoted = identityLine.match(/"([^"]+)"/);
  if (quoted?.[1] !== undefined) {
    return quoted[1];
  }
  const hash = identityLine.match(/^\s*\d+\)\s+([A-F0-9]+)\s/i);
  if (hash?.[1] !== undefined) {
    return hash[1];
  }
  return null;
}

export function inspectCodesignIdentity(): CodesignIdentityStatus {
  const identities = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    encoding: "utf8",
  });
  const identityLine = identities.stdout
    .split("\n")
    .find((line) => /^\s+\d+\)/.test(line) && line.includes('"'));
  if (identityLine !== undefined) {
    const identityName = parseIdentityName(identityLine);
    if (identityName !== null) {
      return { kind: "ready", identityLine: identityLine.trim(), identityName };
    }
  }

  const certificate = spawnSync("security", ["find-certificate", "-c", "Apple Development", "-p"], {
    encoding: "utf8",
  });
  if ((certificate.status ?? 1) === 0 && certificate.stdout.includes("BEGIN CERTIFICATE")) {
    const subject = spawnSync("openssl", ["x509", "-noout", "-subject"], {
      input: certificate.stdout,
      encoding: "utf8",
    });
    const certificateSubject = subject.stdout.replace(/^subject=\s*/, "").trim();
    if (certificateSubject.length > 0) {
      return { kind: "cert-without-private-key", certificateSubject };
    }
  }

  return { kind: "missing" };
}

export function printCodesignIdentityHelp(status: CodesignIdentityStatus): void {
  switch (status.kind) {
    case "ready":
      console.info(`[desktop:codesign] Ready: ${status.identityLine}`);
      console.info(`[desktop:codesign] Will sign with: ${status.identityName}`);
      return;
    case "cert-without-private-key":
      console.warn(
        "[desktop:dev] Apple Development certificate found, but its private key is missing.",
      );
      console.warn(`[desktop:dev] Certificate: ${status.certificateSubject}`);
      console.warn("[desktop:dev] Fix in Xcode:");
      console.warn("  1. Xcode → Settings → Accounts → your Apple ID");
      console.warn("  2. Manage Certificates… → delete the broken Apple Development entry");
      console.warn("  3. Click + → Apple Development (creates cert + private key)");
      console.warn("  4. Verify: security find-identity -v -p codesigning");
      console.warn(
        "[desktop:dev] Until then, use Safari on https://localhost:8443 for passkey bootstrap.",
      );
      return;
    case "missing":
      console.warn("[desktop:dev] No codesigning identity for Touch ID passkeys.");
      console.warn(
        "[desktop:dev] Sign in to Xcode, create an Apple Development certificate, then restart.",
      );
      console.warn("[desktop:dev] Or use Safari on https://localhost:8443 for passkey bootstrap.");
      return;
  }
}
