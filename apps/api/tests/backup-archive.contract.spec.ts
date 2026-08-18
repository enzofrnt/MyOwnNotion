/**
 * What a produced archive does and does not contain (T011, FR-001, FR-004, FR-007).
 *
 * The assertion that matters is the negative one. An archive is the one artefact
 * this product deliberately copies to somewhere it does not control, so a secret
 * inside it is a secret handed to a third party — and unlike a leaked log line,
 * it is retained for three months by policy.
 *
 * So the test seeds recognisable secrets into the installation, produces a real
 * archive, decrypts it, and searches. Searching the *ciphertext* would pass for
 * any encryption at all; searching the plaintext is what proves the archive was
 * built without them rather than merely sealed over them.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { open as openSealed, seal } from "@myownnotion/domain/security";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackupService } from "../src/backup/backup-service.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { type ApiHarness, createApiHarness, createItemViaApi } from "./helpers/app.ts";

let harness: ApiHarness;
let destinationRoot: string;

/** The key the archive is sealed under; the real one is mounted, not generated. */
const ARCHIVE_KEY = randomBytes(32);
const ARCHIVE_AAD = Buffer.from("myownnotion.backup.v1", "utf8");

beforeAll(async () => {
  harness = await createApiHarness();
  destinationRoot = mkdtempSync(path.join(os.tmpdir(), "mon-backup-dest-"));
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(destinationRoot, { recursive: true, force: true });
});

function serviceFor(): BackupService {
  return new BackupService({
    context: harness.built.context,
    destination: new FilesystemDestination(destinationRoot),
    applicationVersion: "0.1.0-test",
    seal: async (plaintext) => {
      const sealed = seal(ARCHIVE_KEY, plaintext, ARCHIVE_AAD);
      return Buffer.concat([
        Buffer.from(sealed.nonce),
        Buffer.from(sealed.tag),
        Buffer.from(sealed.ciphertext),
      ]);
    },
    open: async (ciphertext) => {
      const nonce = ciphertext.subarray(0, 12);
      const tag = ciphertext.subarray(12, 28);
      const body = ciphertext.subarray(28);
      return Buffer.from(openSealed(ARCHIVE_KEY, { nonce, tag, ciphertext: body }, ARCHIVE_AAD));
    },
  });
}

async function producedArchive(): Promise<{
  plaintext: string;
  outcome: Awaited<ReturnType<BackupService["run"]>>;
}> {
  const service = serviceFor();
  const outcome = await service.run("manual");
  const destination = new FilesystemDestination(destinationRoot);
  const stream = await destination.read(outcome.name);
  if (stream === null) {
    throw new Error("the archive was not stored");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  const ciphertext = Buffer.concat(chunks);
  const nonce = ciphertext.subarray(0, 12);
  const tag = ciphertext.subarray(12, 28);
  const body = ciphertext.subarray(28);
  const plaintext = Buffer.from(
    openSealed(ARCHIVE_KEY, { nonce, tag, ciphertext: body }, ARCHIVE_AAD),
  ).toString("utf8");
  return { plaintext, outcome };
}

describe("producing an archive", () => {
  it("verifies it after creation and after transfer", async () => {
    await createItemViaApi(harness, { kind: "folder", name: "Backed up" });
    const { outcome } = await producedArchive();
    // Two checks, not one repeated: the second re-read the object from the
    // destination, which is the only way a corrupted upload is caught.
    expect(outcome.verifiedAfterCreation).toBe(true);
    expect(outcome.verifiedAfterTransfer).toBe(true);
    expect(outcome.detail).toBeUndefined();
  });

  it("names the change-feed position it represents", async () => {
    const { outcome } = await producedArchive();
    // Consistency is not a separate mechanism: "one moment" is a number the
    // product already has, and recording it lets an owner say what they lost in
    // changes rather than in minutes.
    expect(outcome.cursor).toMatch(/^\d+$/);
  });

  it("carries the versions needed to read it back", async () => {
    const { plaintext } = await producedArchive();
    const archive = JSON.parse(plaintext) as { manifest: Record<string, unknown> };
    expect(archive.manifest["applicationVersion"]).toBe("0.1.0-test");
    expect(typeof archive.manifest["schemaVersion"]).toBe("number");
    expect(typeof archive.manifest["recordFormatVersion"]).toBe("number");
  });

  it("stores nothing readable at the destination", async () => {
    const { outcome } = await producedArchive();
    const destination = new FilesystemDestination(destinationRoot);
    const stream = await destination.read(outcome.name);
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    // Encrypted before it left the machine (FR-007). The destination sees an
    // opaque blob and a name, and the name carries a date and nothing else.
    expect(raw).not.toContain("myownnotion.backup");
    expect(raw).not.toContain("canonicalExport");
    expect(outcome.name).not.toMatch(/workspace|item|page/i);
  });
});

describe("what an archive must never contain", () => {
  it("holds no session, key or recovery material, once decrypted", async () => {
    const { plaintext } = await producedArchive();
    // Searched *after* decryption on purpose. Searching the ciphertext would
    // pass for any encryption at all and would prove nothing about what was put
    // inside.
    for (const forbidden of [
      "mn_dev_session",
      "BEGIN PRIVATE KEY",
      "recovery-kit",
      "session_secret_hash",
      "wrapping_key",
      "password_hash",
    ]) {
      expect(plaintext, `archive contains ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("puts no workspace content in the manifest", async () => {
    await createItemViaApi(harness, { kind: "folder", name: "SecretlyNamedFolder" });
    const { plaintext } = await producedArchive();
    const archive = JSON.parse(plaintext) as { manifest: unknown };
    // The manifest is the first thing anybody inspects — an operator listing
    // backups, a support transcript, a bug report — so a title quoted here would
    // leak the workspace into every one of those places.
    expect(JSON.stringify(archive.manifest)).not.toContain("SecretlyNamedFolder");
  });
});
