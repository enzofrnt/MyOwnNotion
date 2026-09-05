import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { authenticatedManifest, createUpdateDriver, RELEASE_ROOT } from "../src/update-download.ts";
import { type UpdateDriver, UpdateOrchestrator } from "../src/updates.ts";

const manifest = {
  format: "myownnotion.desktop-update.v1",
  version: "0.2.0",
  platform: "darwin",
  architecture: "arm64",
  channel: "stable",
  artifactUrl: `${RELEASE_ROOT}/download/v0.2.0/MyOwnNotion-0.2.0-darwin-arm64.dmg`,
  artifactSha512: "a".repeat(128),
  releaseNotesUrl: `${RELEASE_ROOT}/tag/v0.2.0`,
  minimumServerProtocol: "3",
  maximumServerProtocol: "3",
} as const;
const host = { version: "0.1.0", platform: "darwin", architecture: "arm64", protocol: 3 } as const;
function driver(): UpdateDriver {
  return {
    host,
    manifest: vi.fn(async () => manifest),
    download: vi.fn(async () => "installer"),
    launch: vi.fn(async () => {}),
  };
}
describe("authenticated updates and recovery", () => {
  it("makes a verified Linux AppImage executable only by its owner before handoff", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mon-linux-update-test-"));
    try {
      const bytes = Buffer.from("verified AppImage fixture");
      const file = path.join(directory, "MyOwnNotion-0.2.0-linux-arm64.AppImage");
      const candidate = {
        ...manifest,
        platform: "linux" as const,
        artifactUrl: `${RELEASE_ROOT}/download/v0.2.0/MyOwnNotion-0.2.0-linux-arm64.AppImage`,
        artifactSha512: createHash("sha512").update(bytes).digest("hex"),
      };
      await writeFile(file, bytes, { mode: 0o600 });
      const launch = vi.fn(async () => {
        if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o700);
      });
      const transport = createUpdateDriver({
        host: { ...host, platform: "linux" },
        publicKey: "",
        directory,
        launch,
      });
      await transport.launch(file, candidate);
      expect(launch).toHaveBeenCalledOnce();
      expect(await readFile(file)).toEqual(bytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("authenticates exact bytes and refuses tampering or another signer", () => {
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const payload = Buffer.from(JSON.stringify(manifest));
    const signature = sign(null, payload, keys.privateKey);
    expect(authenticatedManifest(payload, signature, publicKey)).toEqual(manifest);
    expect(() => authenticatedManifest(Buffer.from("{}"), signature, publicKey)).toThrow();
    expect(() =>
      authenticatedManifest(
        payload,
        sign(null, payload, generateKeyPairSync("ed25519").privateKey),
        publicKey,
      ),
    ).toThrow();
  });
  it("preserves the real vault and refuses a corrupt installer at handoff", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mon-update-test-"));
    try {
      const vault = path.join(directory, "vault.envelope");
      await writeFile(vault, "encrypted pending mutation fixture");
      const file = path.join(directory, "MyOwnNotion-0.2.0-darwin-arm64.dmg");
      await writeFile(file, "corrupted installer");
      const launch = vi.fn();
      const transport = createUpdateDriver({ host, publicKey: "", directory, launch });
      await expect(transport.launch(file, manifest)).rejects.toThrow("digest mismatch");
      expect(launch).not.toHaveBeenCalled();
      expect(await readFile(vault, "utf8")).toBe("encrypted pending mutation fixture");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("blocks unknown or pending local state, defers, then downloads before handoff", async () => {
    const io = driver();
    const updates = new UpdateOrchestrator(io);
    expect((await updates.check()).phase).toBe("available");
    await updates.install();
    expect(io.download).not.toHaveBeenCalled();
    expect(updates.defer().phase).toBe("deferred");
    updates.setContext({ pendingLocalChanges: false });
    expect((await updates.install()).phase).toBe("installing");
    expect(io.launch).toHaveBeenCalledWith("installer", manifest);
    expect(updates.snapshot().phase).not.toBe("restarted");
  });
  it("retains current installation after failed download and allows retry", async () => {
    const io = driver();
    vi.mocked(io.download).mockRejectedValueOnce(new Error("network"));
    const updates = new UpdateOrchestrator(io);
    updates.setContext({ pendingLocalChanges: false });
    await updates.check();
    expect((await updates.install()).phase).toBe("download-failed");
    expect(io.launch).not.toHaveBeenCalled();
    expect((await updates.install()).phase).toBe("installing");
  });
  it("rechecks new local work arriving during download", async () => {
    const io = driver();
    const updates = new UpdateOrchestrator(io);
    vi.mocked(io.download).mockImplementation(async () => {
      updates.setContext({ pendingLocalChanges: true });
      return "installer";
    });
    updates.setContext({ pendingLocalChanges: false });
    await updates.check();
    expect((await updates.install()).phase).toBe("downloaded");
    expect(io.launch).not.toHaveBeenCalled();
  });
  it.each([
    { version: "0.0.9" },
    { platform: "linux" },
    { minimumServerProtocol: "4", maximumServerProtocol: "4" },
  ])("refuses incompatible candidate %j", async (change) => {
    const io = driver();
    vi.mocked(io.manifest).mockResolvedValue({ ...manifest, ...change });
    const updates = new UpdateOrchestrator(io);
    expect((await updates.check()).phase).toBe("incompatible");
    await updates.install();
    expect(io.download).not.toHaveBeenCalled();
  });
});
