import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, open, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FULL_BACKUP_FORMAT, type FullBackupManifest } from "@myownnotion/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FULL_ARCHIVE_MAGIC,
  MAX_FULL_MANIFEST_BYTES,
  VerifiedFullArchive,
  writeFullArchive,
} from "../src/backup/full/archive.ts";
import {
  componentAad,
  openFullManifest,
  openFullStream,
  sealFullManifest,
  sealFullStream,
  writeExactly,
} from "../src/backup/full/crypto.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "mon-full-archive-test-"));
  directories.push(directory);
  const key = randomBytes(32);
  const backupId = randomUUID();
  const plaintext = [
    Buffer.from("PGDMP private database sentinel"),
    randomBytes(192 * 1024),
    Buffer.alloc(0),
  ];
  const digest = createHash("sha256")
    .update(plaintext[1] as Buffer)
    .digest("hex");
  const paths = ["database.dump", `${digest.slice(0, 2)}/${digest}`, `uploads/${randomUUID()}`];
  const encryptedComponents: string[] = [];
  const components: FullBackupManifest["components"][number][] = [];
  for (const [index, bytes] of plaintext.entries()) {
    const path = paths[index] as string;
    const destination = join(directory, `component-${index}`);
    const metadata = await sealFullStream(
      chunks(bytes),
      key,
      componentAad(backupId, index, path),
      destination,
    );
    encryptedComponents.push(destination);
    components.push({
      kind: index === 0 ? "database" : index === 1 ? "blob" : "upload",
      path,
      ...metadata,
    });
  }
  const manifest: FullBackupManifest = {
    format: FULL_BACKUP_FORMAT,
    formatVersion: 1,
    backupId,
    createdAt: "2026-09-05T01:02:03.000Z",
    reason: "manual",
    source: {
      installationId: null,
      applicationVersion: null,
      commit: null,
      image: null,
      postgresVersion: 180004,
      appliedMigrations: ["0001_initial"],
    },
    components,
  };
  const destination = join(directory, "backup.monfull");
  return { directory, key, plaintext, manifest, destination, encryptedComponents };
}

async function* chunks(bytes: Buffer): AsyncGenerator<Buffer> {
  for (let offset = 0; offset < bytes.length; offset += 8191)
    yield bytes.subarray(offset, offset + 8191);
}
async function collect(input: AsyncIterable<Buffer>): Promise<Buffer> {
  const result: Buffer[] = [];
  for await (const bytes of input) result.push(bytes);
  return Buffer.concat(result);
}

describe("complete encrypted archives", () => {
  it("round-trips streamed files and empty upload prefixes without a source catalogue", async () => {
    const fixture = await setup();
    await writeFullArchive(fixture);
    expect((await stat(fixture.destination)).mode & 0o777).toBe(0o600);
    expect((await readFile(fixture.destination)).includes(fixture.plaintext[0] as Buffer)).toBe(
      false,
    );
    const reader = await VerifiedFullArchive.open(
      fixture.destination,
      fixture.key,
      fixture.directory,
    );
    expect(reader.manifest).toEqual(fixture.manifest);
    for (const [index, expected] of fixture.plaintext.entries()) {
      expect(await collect(reader.component(index))).toEqual(expected);
    }
    expect(() => reader.component(42)).toThrow("Unknown backup component");
    await reader.close();
    await reader.close();
    expect(() => reader.component(0)).toThrow("closed");
    expect((await readdir(fixture.directory)).some((name) => name.startsWith(".full-"))).toBe(
      false,
    );
  });

  it("refuses oversized manifests before publication and truncated authenticated headers", async () => {
    const fixture = await setup();
    expect(() => openFullManifest(fixture.key, Buffer.alloc(27))).toThrow("truncated");
    const manifest = {
      ...fixture.manifest,
      source: {
        ...fixture.manifest.source,
        appliedMigrations: ["a".repeat(MAX_FULL_MANIFEST_BYTES)],
      },
    };
    await expect(writeFullArchive({ ...fixture, manifest })).rejects.toThrow("manifest exceeds");
    await expect(stat(fixture.destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(fixture.directory)).some((name) => name.startsWith(".full-"))).toBe(
      false,
    );
  });

  it("refuses zero-progress disk writes and invalid stream keys without consuming the source", async () => {
    const fixture = await setup();
    const component = fixture.encryptedComponents[0];
    if (component === undefined) throw new Error("fixture component missing");
    const handle = await open(component, "r+");
    try {
      const write = vi.spyOn(handle, "write").mockResolvedValueOnce({ bytesWritten: 0 } as never);
      await expect(writeExactly(handle, Buffer.from("must not loop"), 0)).rejects.toThrow(
        "could not be written",
      );
      expect(write).toHaveBeenCalledOnce();
      write.mockRestore();
      await expect(
        collect(
          openFullStream(
            handle,
            0,
            fixture.plaintext[0]?.byteLength ?? 0,
            Buffer.alloc(3),
            componentAad(fixture.manifest.backupId, 0, "database.dump"),
          ),
        ),
      ).rejects.toThrow();
      expect(
        await collect(
          openFullStream(
            handle,
            0,
            fixture.plaintext[0]?.byteLength ?? 0,
            fixture.key,
            componentAad(fixture.manifest.backupId, 0, "database.dump"),
          ),
        ),
      ).toEqual(fixture.plaintext[0]);
    } finally {
      await handle.close();
    }
  });

  it("retains verified bytes if the external source changes afterwards", async () => {
    const fixture = await setup();
    await writeFullArchive(fixture);
    const reader = await VerifiedFullArchive.open(
      fixture.destination,
      fixture.key,
      fixture.directory,
    );
    try {
      await writeFile(fixture.destination, "replaced source");
      expect(await collect(reader.component(0))).toEqual(fixture.plaintext[0]);
    } finally {
      await reader.close();
    }
  });

  it.each([
    "wrong-key",
    "manifest",
    "last-component",
    "truncated",
    "trailing",
    "magic",
    "oversized-manifest",
  ])(
    "rejects %s before exposing restore streams and removes its private snapshot",
    async (failure) => {
      const fixture = await setup();
      await writeFullArchive(fixture);
      let bytes = await readFile(fixture.destination);
      let key = fixture.key;
      if (failure === "wrong-key") key = randomBytes(32);
      if (failure === "manifest")
        bytes[FULL_ARCHIVE_MAGIC.length + 4] = (bytes[FULL_ARCHIVE_MAGIC.length + 4] ?? 0) ^ 1;
      if (failure === "last-component")
        bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
      if (failure === "truncated") bytes = bytes.subarray(0, bytes.length - 1);
      if (failure === "trailing") bytes = Buffer.concat([bytes, Buffer.from([0])]);
      if (failure === "magic") bytes[0] = 0;
      if (failure === "oversized-manifest")
        bytes.writeUInt32BE(MAX_FULL_MANIFEST_BYTES + 1, FULL_ARCHIVE_MAGIC.length);
      await writeFile(fixture.destination, bytes);
      await expect(
        VerifiedFullArchive.open(fixture.destination, key, fixture.directory),
      ).rejects.toThrow();
      expect((await readdir(fixture.directory)).some((name) => name.startsWith(".full-"))).toBe(
        false,
      );
    },
  );

  it("refuses a validly encrypted manifest with unsafe component paths", async () => {
    const fixture = await setup();
    const manifest = {
      ...fixture.manifest,
      components: [{ ...fixture.manifest.components[0], path: "../database.dump" }],
    };
    const sealed = sealFullManifest(fixture.key, Buffer.from(JSON.stringify(manifest)));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(sealed.length);
    await writeFile(fixture.destination, Buffer.concat([FULL_ARCHIVE_MAGIC, length, sealed]));
    await expect(
      VerifiedFullArchive.open(fixture.destination, fixture.key, fixture.directory),
    ).rejects.toThrow("component");
  });

  it("never publishes a component whose authenticated content differs from its manifest hash", async () => {
    const fixture = await setup();
    const manifest = {
      ...fixture.manifest,
      components: fixture.manifest.components.map((component) => ({
        ...component,
        sha256: "0".repeat(64),
      })),
    };
    await expect(writeFullArchive({ ...fixture, manifest })).rejects.toThrow("integrity");
    await expect(stat(fixture.destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(fixture.directory)).some((name) => name.startsWith(".full-"))).toBe(
      false,
    );
  });

  it("binds staged ciphertext to backup identity and refuses an incomplete inventory", async () => {
    const fixture = await setup();
    await expect(
      writeFullArchive({ ...fixture, manifest: { ...fixture.manifest, backupId: randomUUID() } }),
    ).rejects.toThrow();
    await expect(writeFullArchive({ ...fixture, encryptedComponents: [] })).rejects.toThrow(
      "incomplete",
    );
    await expect(stat(fixture.destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite an existing artifact or follow an input symlink", async () => {
    const fixture = await setup();
    await writeFullArchive(fixture);
    const original = await readFile(fixture.destination);
    await expect(writeFullArchive(fixture)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(fixture.destination)).toEqual(original);
    const alias = join(fixture.directory, "alias");
    await symlink(fixture.destination, alias);
    await expect(VerifiedFullArchive.open(alias, fixture.key, fixture.directory)).rejects.toThrow();
    await expect(
      VerifiedFullArchive.open(fixture.directory, fixture.key, fixture.directory),
    ).rejects.toThrow("regular file");
  });

  it("removes encrypted staging after interruption and never stages plaintext", async () => {
    const fixture = await setup();
    const destination = join(fixture.directory, "interrupted");
    async function* interrupted() {
      yield Buffer.from("private interrupted dump sentinel");
      expect(
        (await readFile(destination)).includes(Buffer.from("private interrupted dump sentinel")),
      ).toBe(false);
      throw new Error("dump process failed");
    }
    await expect(
      sealFullStream(interrupted(), fixture.key, Buffer.from("test"), destination),
    ).rejects.toThrow("dump process failed");
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.key.some((byte) => byte !== 0)).toBe(true);
  });
});
