/**
 * One suite, both destinations (T043, FR-009).
 *
 * The boundary exists so a second destination can be added, and a boundary is
 * only worth having if both sides genuinely satisfy it. So this file states the
 * contract once and runs it twice — against a directory on disk, and against
 * Google Drive backed by a recorded interaction.
 *
 * Written as a shared suite rather than two files on purpose. Two files drift:
 * the local one gets a test the remote one never gets, and the day somebody
 * switches destination they discover a behaviour that was only ever asserted for
 * the implementation they left behind.
 */

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BackupDestination } from "../src/backup/destinations/destination.ts";
import { DestinationUnavailableError } from "../src/backup/destinations/destination.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { GoogleDriveDestination } from "../src/backup/destinations/google-drive.ts";

/** A Drive that lives in a Map: the recorded interaction, not a mocked client. */
function recordedDrive(): { destination: BackupDestination; stored: Map<string, Buffer> } {
  const stored = new Map<string, Buffer>();
  const ids = new Map<string, string>();
  const sessions = new Map<string, string>();
  let nextId = 1;

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = input.toString();

    if (url.includes("/upload/drive/v3/files")) {
      const metadata = JSON.parse(String(init?.body)) as { name: string };
      const location = `https://recorded.example/upload/${nextId++}`;
      sessions.set(location, metadata.name);
      return new Response(null, { status: 200, headers: { location } });
    }

    if (sessions.has(url) && init?.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of init.body as never as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      const name = sessions.get(url) as string;
      stored.set(name, Buffer.concat(chunks));
      ids.set(name, `id-${nextId++}`);
      sessions.delete(url);
      return new Response(JSON.stringify({ id: ids.get(name) }), { status: 200 });
    }

    if (url.includes("alt=media")) {
      const id = /files\/([^?]+)\?/.exec(url)?.[1];
      const name = [...ids].find(([, value]) => value === id)?.[0];
      const bytes = name === undefined ? undefined : stored.get(name);
      return bytes === undefined
        ? new Response(null, { status: 404 })
        : new Response(Uint8Array.from(bytes), { status: 200 });
    }

    if (url.includes("/files?q=")) {
      const query = new URL(url).searchParams.get("q") ?? "";
      const named = /name = '([^']+)'/.exec(query)?.[1];
      const files = [...stored.entries()]
        .filter(([name]) => named === undefined || name === named)
        .map(([name, bytes]) => ({
          id: ids.get(name),
          name,
          size: String(bytes.byteLength),
          createdTime: new Date(0).toISOString(),
        }));
      return new Response(JSON.stringify({ files }), { status: 200 });
    }

    if (init?.method === "DELETE") {
      const id = /files\/([^?]+)$/.exec(url)?.[1];
      const name = [...ids].find(([, value]) => value === id)?.[0];
      if (name !== undefined) {
        stored.delete(name);
        ids.delete(name);
      }
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 404 });
  };

  return {
    stored,
    destination: new GoogleDriveDestination({
      accessToken: () => "recorded",
      folderId: "folder",
      fetch: fetchImpl,
    }),
  };
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "mon-dest-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const implementations: Array<[string, () => BackupDestination]> = [
  ["filesystem", () => new FilesystemDestination(mkdtempSync(path.join(root, "fs-")))],
  ["google-drive", () => recordedDrive().destination],
];

describe.each(implementations)("a %s destination", (_label, create) => {
  it("stores what it is given and reads it back byte for byte", async () => {
    const destination = create();
    const payload = Buffer.from("sealed archive bytes");
    await destination.put("backup-one.bin", Readable.from(payload), payload.byteLength);

    const stream = await destination.read("backup-one.bin");
    expect(stream).not.toBeNull();
    const chunks: Buffer[] = [];
    for await (const chunk of stream as NodeJS.ReadableStream) {
      chunks.push(chunk as Buffer);
    }
    // The whole reason `read` is on the boundary: verification after transfer
    // has to compare what arrived, not re-hash what was sent.
    expect(Buffer.concat(chunks)).toEqual(payload);
  });

  it("answers null for something it does not hold", async () => {
    const destination = create();
    // Absent is an answer, not an exception: verification records "the
    // destination no longer holds this backup" rather than surviving a throw.
    expect(await destination.read("never-stored.bin")).toBeNull();
  });

  it("lists what it holds, with sizes", async () => {
    const destination = create();
    const payload = Buffer.from("twelve bytes");
    await destination.put("listed.bin", Readable.from(payload), payload.byteLength);

    const listed = await destination.list();
    const entry = listed.find((candidate) => candidate.name === "listed.bin");
    expect(entry?.byteLength).toBe(payload.byteLength);
  });

  it("deletes, and tolerates deleting something already gone", async () => {
    const destination = create();
    const payload = Buffer.from("temporary");
    await destination.put("doomed.bin", Readable.from(payload), payload.byteLength);
    await destination.delete("doomed.bin");
    expect(await destination.read("doomed.bin")).toBeNull();
    // Retention asking twice must not fail the pass, or one manual deletion
    // would stop every future prune.
    await expect(destination.delete("doomed.bin")).resolves.toBeUndefined();
  });

  it("has a name that identifies it without naming a credential", async () => {
    const destination = create();
    expect(destination.name).toMatch(/^[a-z-]+$/);
  });
});

describe("what a destination is told", () => {
  it("receives a name carrying no workspace information", async () => {
    const { destination, stored } = recordedDrive();
    const payload = Buffer.from("sealed");
    await destination.put(
      "myownnotion-backup-2026-08-18T04-00-00-000Z-01a10000.bin",
      Readable.from(payload),
      payload.byteLength,
    );
    const [name] = [...stored.keys()];
    // A provider that can list your backups should learn nothing from the
    // listing: a date and an identifier, never an item count or a title.
    expect(name).not.toMatch(/item|page|folder|workspace/i);
  });
});

describe("an unusable destination", () => {
  it("names the destination, not tonight's archive", () => {
    // An unreachable destination means every backup will fail until somebody
    // fixes it: the error has to point at the destination itself.
    const error = new DestinationUnavailableError("filesystem", "the root is gone");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DestinationUnavailableError");
    expect(error.destination).toBe("filesystem");
    expect(error.message).toBe("backup destination filesystem is unavailable: the root is gone");
  });

  it("is what a traversal-shaped name raises", async () => {
    const destination = new FilesystemDestination(mkdtempSync(path.join(root, "traversal-")));
    await expect(
      destination.put("../escape.bin", Readable.from(Buffer.from("no")), 2),
    ).rejects.toMatchObject({ name: "DestinationUnavailableError" });
  });
});
