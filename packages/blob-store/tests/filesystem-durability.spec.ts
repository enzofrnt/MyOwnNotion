import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FilesystemBlobStore } from "@myownnotion/blob-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
let root: string;
let blobs: FilesystemBlobStore;
const payload = Buffer.from("private ciphertext fixture");
const key = createHash("sha256").update(payload).digest("hex");
const prefix = key.slice(0, 2);

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mon-durable-blobs-"));
  blobs = new FilesystemBlobStore(path.join(root, "blobs"));
  vi.mocked(open).mockImplementation(actual.open);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("durable immutable blob publication", () => {
  it("publishes concurrent identical writes with private modes and no staging leftovers", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => blobs.put(payload)));
    expect(new Set(results.map((result) => result.storageKey))).toEqual(new Set([key]));
    const directory = path.join(root, "blobs", prefix);
    expect(await readdir(directory)).toEqual([key]);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(directory, key))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(directory, key))).toEqual(payload);
    const empty = await blobs.put(Buffer.alloc(0));
    expect(await blobs.get(empty.storageKey)).toEqual(new Uint8Array(0));
  });

  it("refuses corruption instead of replacing an existing immutable key", async () => {
    await blobs.put(payload);
    const filename = path.join(root, "blobs", prefix, key);
    await writeFile(filename, "damaged bytes");
    await expect(blobs.put(payload)).rejects.toThrow("digest mismatch");
    expect(await readFile(filename, "utf8")).toBe("damaged bytes");
    await expect(blobs.get(key)).rejects.toThrow("digest mismatch");
    expect(await readdir(path.dirname(filename))).toEqual([key]);
  });

  it.each(["root", "prefix", "file"] as const)(
    "refuses a symlink at the %s boundary",
    async (boundary) => {
      const outside = path.join(root, "outside");
      await mkdir(outside);
      const directory = path.join(root, "blobs", prefix);
      if (boundary === "root") {
        await symlink(outside, path.join(root, "blobs"));
      } else if (boundary === "prefix") {
        await mkdir(path.join(root, "blobs"));
        await symlink(outside, directory);
      } else {
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(outside, key), payload);
        await symlink(path.join(outside, key), path.join(directory, key));
      }
      await expect(blobs.put(payload)).rejects.toThrow();
      await expect(blobs.get(key)).rejects.toThrow();
      if (boundary !== "file") await expect(blobs.delete(key)).rejects.toThrow();
      expect(await readdir(outside)).toEqual(boundary === "file" ? [key] : []);
    },
  );

  it("does not publish a key when syncing its bytes fails", async () => {
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (String(args[0]).includes(".tmp-"))
        vi.spyOn(handle, "sync").mockRejectedValue(new Error("disk sync failed"));
      return handle;
    });
    await expect(blobs.put(payload)).rejects.toThrow("disk sync failed");
    expect(await readdir(path.join(root, "blobs", prefix))).toEqual([]);
    expect(await blobs.get(key)).toBeNull();
  });

  it.each(["modified", "truncated", "extended"] as const)(
    "removes staging when persisted bytes are %s before verification",
    async (damage) => {
      vi.mocked(open).mockImplementation(async (...args) => {
        const handle = await actual.open(...args);
        if (String(args[0]).includes(".tmp-")) {
          const read = handle.read.bind(handle);
          vi.spyOn(handle, "read").mockImplementationOnce((async (
            buffer: Buffer,
            offset: number,
            length: number,
            position: number,
          ) => {
            if (damage === "truncated") await handle.truncate(payload.length - 1);
            else
              await handle.write(
                Buffer.from([0xff]),
                0,
                1,
                damage === "extended" ? payload.length : 0,
              );
            return read(buffer, offset, length, position);
          }) as typeof handle.read);
        }
        return handle;
      });
      await expect(blobs.put(payload)).rejects.toThrow("verification failed");
      expect(await readdir(path.join(root, "blobs", prefix))).toEqual([]);
    },
  );

  it("verifies complete persisted bytes across short reads with bounded scratch space", async () => {
    const large = Buffer.alloc(150 * 1024 + 17, 0x93);
    const lengths: number[] = [];
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (String(args[0]).includes(".tmp-")) {
        const read = handle.read.bind(handle);
        vi.spyOn(handle, "read").mockImplementation((async (
          buffer: Buffer,
          offset: number,
          length: number,
          position: number,
        ) => {
          lengths.push(length);
          return read(buffer, offset, Math.min(length, 7919), position);
        }) as typeof handle.read);
      }
      return handle;
    });
    const stored = await blobs.put(large);
    expect(lengths.length).toBeGreaterThan(19);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(64 * 1024);
    const opened = await blobs.get(stored.storageKey);
    expect(opened).not.toBeNull();
    expect(Buffer.compare(opened as Uint8Array, large)).toBe(0);
    opened?.fill(0);
    expect(Buffer.compare((await blobs.get(stored.storageKey)) as Uint8Array, large)).toBe(0);
    expect(large[0]).toBe(0x93);
  });

  it("refuses success after a publication-directory sync failure and can safely retry", async () => {
    const directory = path.join(root, "blobs", prefix);
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actual.open(...args);
      if (String(args[0]) === directory)
        vi.spyOn(handle, "sync").mockRejectedValue(new Error("directory sync failed"));
      return handle;
    });
    await expect(blobs.put(payload)).rejects.toThrow("directory sync failed");
    expect(await readdir(directory)).toEqual([key]);
    vi.mocked(open).mockImplementation(actual.open);
    expect((await blobs.put(payload)).storageKey).toBe(key);
    expect(Buffer.from((await blobs.get(key)) ?? [])).toEqual(payload);
  });
});
