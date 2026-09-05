import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openBackupArchive, sealBackupArchiveStream } from "../src/backup/archive-crypto.ts";
import { BackupService } from "../src/backup/backup-service.ts";
import { createDatabaseRestoreTarget } from "../src/backup/database-restore-target.ts";
import { FilesystemDestination } from "../src/backup/destinations/filesystem.ts";
import { applyArchive } from "../src/backup/restore-service.ts";
import { ProtectedUploadService } from "../src/files/protected-upload-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness, createItemViaApi } from "./helpers/app.ts";
import { authenticatedContent } from "./helpers/content-owner.ts";

let harness: ApiHarness;
let owner: Awaited<ReturnType<typeof authenticatedContent>>;
let keyRoot: string;
let security: ReturnType<typeof loadSecurityConfig>;
const BODY = "Private attachment content sentinel from secured HTTP upload";
const NAME = "Private-confidential-filename-sentinel.txt";
beforeAll(async () => {
  keyRoot = await mkdtemp(path.join(os.tmpdir(), "mon-protected-http-key-"));
  const keyFile = path.join(keyRoot, "deployment-key");
  await writeFile(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  security = loadSecurityConfig({
    MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    MYOWNNOTION_API_HOST: "127.0.0.1",
    MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
  });
  harness = await createApiHarness({ security });
  owner = await authenticatedContent(harness);
});
afterAll(async () => {
  await harness?.close();
  if (keyRoot !== undefined) await rm(keyRoot, { recursive: true, force: true });
});

async function physicalContains(directory: string, sentinel: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (await physicalContains(filename, sentinel)) return true;
    } else if ((await readFile(filename)).includes(Buffer.from(sentinel))) return true;
  }
  return false;
}

async function directImport(
  options: { filename?: string; parentItemId?: string } = {},
): Promise<string> {
  const boundary = `mon-${generateUuidV7()}`;
  const payload = Buffer.from(
    [
      `--${boundary}\r\nContent-Disposition: form-data; name="placement"\r\n\r\n`,
      `${JSON.stringify({ kind: "hierarchy", parentItemId: options.parentItemId ?? null, positionKey: "V" })}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? NAME}"\r\nContent-Type: text/plain\r\n\r\n`,
      BODY,
      `\r\n--${boundary}--\r\n`,
    ].join(""),
  );
  const response = await owner({
    method: "POST",
    url: "/v1/files",
    payload,
    headers: {
      "idempotency-key": generateUuidV7(),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().item.id as string;
}

describe("private files through authenticated HTTP", () => {
  it("returns the committed identity when a concurrent final PATCH removes the partial transfer", async () => {
    const created = await owner({
      method: "POST",
      url: "/v1/uploads",
      headers: { "upload-length": "4" },
    });
    expect(created.statusCode).toBe(201);
    const url = String(created.headers["location"]);
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const append = ProtectedUploadService.prototype.append;
    const interleaving = vi
      .spyOn(ProtectedUploadService.prototype, "append")
      .mockImplementationOnce(async function (this: ProtectedUploadService, tx, input) {
        entered();
        await resume;
        return append.call(this, tx, input);
      });
    const request = {
      method: "PATCH" as const,
      url,
      headers: { "upload-offset": "0", "content-type": "application/offset+octet-stream" },
      payload: Buffer.from("data"),
    };
    const delayed = owner(request).then((response) => response);
    try {
      await paused;
      const winner = await owner(request);
      expect(winner.statusCode, winner.body).toBe(201);
      release();
      const replay = await delayed;
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json()).toEqual(winner.json());
      expect(replay.headers["upload-offset"]).toBe("4");
      const downloaded = await owner({
        method: "GET",
        url: `/v1/files/${winner.json().itemId}/content`,
      });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.body).toBe("data");
    } finally {
      release();
      await delayed;
      interleaving.mockRestore();
    }
  });

  it("keeps each descendant file's own private metadata when a folder is trashed", async () => {
    const folder = await createItemViaApi(harness, {
      kind: "folder",
      name: "Folder title",
      headers: owner.headers,
    });
    const ids = [];
    for (const filename of ["first-private-child.txt", "second-private-child.txt"])
      ids.push({ id: await directImport({ filename, parentItemId: folder.itemId }), filename });
    const trashed = await owner({
      method: "POST",
      url: `/v1/items/${folder.itemId}/trash`,
      headers: { "idempotency-key": generateUuidV7() },
    });
    expect(trashed.statusCode, trashed.body).toBe(200);
    for (const { id, filename } of ids) {
      const item = await owner({ method: "GET", url: `/v1/items/${id}` });
      expect(item.json()).toMatchObject({ lifecycle: "trashed", name: filename });
      const revision = await owner({
        method: "GET",
        url: `/v1/revisions/${item.json().currentRevisionId}`,
      });
      expect(revision.statusCode, revision.body).toBe(200);
      expect(revision.json().snapshot).toMatchObject({
        name: filename,
        file: { originalName: filename },
      });
    }
  });
  it("restores a sealed portable archive into protected storage and downloads exact attachment bytes", async () => {
    const id = await directImport();
    const pageId = generateUuidV7();
    const privatePage = await owner({
      method: "POST",
      url: "/v1/items",
      headers: { "idempotency-key": generateUuidV7() },
      payload: {
        id: pageId,
        kind: "page",
        name: `${NAME} page`,
        placement: { kind: "hierarchy", parentItemId: null, positionKey: "V" },
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 1,
          body: { note: BODY },
        },
      },
    });
    expect(privatePage.statusCode, privatePage.body).toBe(201);
    const destinationRoot = await mkdtemp(path.join(os.tmpdir(), "mon-private-portable-"));
    const destination = new FilesystemDestination(destinationRoot);
    const archiveKey = randomBytes(32);
    const target = await createApiHarness({ security });
    try {
      const targetOwner = await authenticatedContent(target);
      const service = new BackupService({
        context: harness.built.context,
        destination,
        applicationVersion: "0.1.0-test",
        seal: (source, filename) => sealBackupArchiveStream(archiveKey, source, filename),
      });
      const outcome = await service.run("manual");
      expect(outcome.verifiedAfterTransfer).toBe(true);
      const archive = openBackupArchive(
        archiveKey,
        await readFile(path.join(destinationRoot, outcome.name)),
      );
      const { protectedContent, protectedFiles } = target.built.context;
      const { pageOperationCrypto } = target.built;
      if (
        protectedContent === undefined ||
        protectedFiles === undefined ||
        pageOperationCrypto === undefined
      )
        throw new Error("Missing protected restore fixture runtime");
      await target.built.database.db.transaction((tx) =>
        applyArchive(
          archive,
          createDatabaseRestoreTarget({
            tx,
            workspaceId: target.built.context.workspaceId,
            contentStore: target.built.context.contentStore,
            protectedContent,
            protectedFiles,
            pageOperationCrypto,
          }),
        ),
      );
      const read = await targetOwner({ method: "GET", url: `/v1/files/${id}/content` });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.body).toBe(BODY);
      expect((await targetOwner({ method: "GET", url: `/v1/items/${id}` })).json().name).toBe(NAME);
      expect(await physicalContains(target.blobRoot, BODY)).toBe(false);
      const rows = await target.built.database.db.execute(
        sql`SELECT i.name, l.original_name, c.sha256, c.storage_key FROM items i JOIN logical_files l ON l.item_id = i.id JOIN file_contents c ON c.id = l.content_id WHERE i.id = ${id}`,
      );
      expect(JSON.stringify(rows.rows)).not.toContain(NAME);
      const restoredPage = await targetOwner({ method: "GET", url: `/v1/items/${pageId}` });
      expect(restoredPage.statusCode, restoredPage.body).toBe(200);
      expect(restoredPage.json()).toMatchObject({
        name: `${NAME} page`,
        pageDocument: { body: { note: BODY } },
      });
      const canonical = await target.built.database.db.execute(sql`
        SELECT to_jsonb(i)::text AS payload FROM items i
        UNION ALL SELECT to_jsonb(p)::text FROM page_documents p
        UNION ALL SELECT to_jsonb(r)::text FROM revisions r
      `);
      expect(JSON.stringify(canonical.rows)).not.toContain(NAME);
      expect(JSON.stringify(canonical.rows)).not.toContain(BODY);
      expect(rows.rows[0]).toMatchObject({ sha256: null, storage_key: null });
    } finally {
      await target.close();
      await rm(destinationRoot, { recursive: true, force: true });
    }
  });
  it("serves authenticated single ranges, refuses invalid ranges and honors If-Range", async () => {
    const id = await directImport();
    const url = `/v1/files/${id}/content`;
    const full = await owner({ method: "GET", url });
    for (const [range, start, end] of [
      ["bytes=0-6", 0, 6],
      ["bytes=8-", 8, BODY.length - 1],
      ["bytes=-5", BODY.length - 5, BODY.length - 1],
      ["bytes=0-999999", 0, BODY.length - 1],
    ] as const) {
      const response = await owner({ method: "GET", url, headers: { range } });
      expect(response.statusCode, response.body).toBe(206);
      expect(response.body).toBe(BODY.slice(start, end + 1));
      expect(response.headers["content-range"]).toBe(`bytes ${start}-${end}/${BODY.length}`);
      expect(response.headers["content-length"]).toBe(String(end - start + 1));
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    }
    for (const range of [
      "bytes=999-",
      "bytes=-0",
      "bytes=8-2",
      "bytes=0-1,3-4",
      "bytes=-",
      "bytes=9007199254740993-",
    ]) {
      const response = await owner({ method: "GET", url, headers: { range } });
      expect(response.statusCode).toBe(416);
      expect(response.headers["content-range"]).toBe(`bytes */${BODY.length}`);
      expect(response.body).toBe("");
    }
    const changed = await owner({
      method: "GET",
      url,
      headers: { range: "bytes=0-2", "if-range": '"old-content"' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.body).toBe(BODY);
    const same = await owner({
      method: "GET",
      url,
      headers: { range: "bytes=0-2", "if-range": full.headers.etag as string },
    });
    expect(same.statusCode).toBe(206);
    const refused = await harness.built.app.inject({
      method: "GET",
      url,
      headers: { range: "bytes=0-2" },
    });
    expect(refused.statusCode).toBe(401);
    expect(refused.body).not.toContain(BODY);
  });

  it("keeps independent logical identities while reusing verified bytes and attributing revisions", async () => {
    const first = await directImport();
    const second = await directImport();
    expect(first).not.toBe(second);
    const rows = await harness.built.database.db.execute(
      sql`SELECT l.item_id, l.content_id, r.authored_by_device_id FROM logical_files l JOIN items i ON i.id = l.item_id JOIN revisions r ON r.id = i.current_revision_id WHERE l.item_id IN (${first}, ${second})`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.["content_id"]).toBe(rows.rows[1]?.["content_id"]);
    expect(rows.rows.every((row) => row["authored_by_device_id"] !== null)).toBe(true);
  });

  it("encrypts direct upload bytes before persistence while preserving authorized downloads", async () => {
    const id = await directImport();
    const downloaded = await owner({ method: "GET", url: `/v1/files/${id}/content` });
    expect(downloaded.statusCode, downloaded.body).toBe(200);
    expect(downloaded.body).toBe(BODY);
    expect(await physicalContains(harness.blobRoot, BODY)).toBe(false);
    const contents = await harness.built.database.db.execute(
      sql`SELECT c.sha256, c.storage_key FROM file_contents c JOIN logical_files l ON l.content_id = c.id WHERE l.item_id = ${id}`,
    );
    expect(contents.rows[0]).toEqual({ sha256: null, storage_key: null });
  });

  it("keeps filenames out of current rows and revision snapshots", async () => {
    const id = await directImport();
    const item = await owner({ method: "GET", url: `/v1/items/${id}` });
    expect(item.statusCode).toBe(200);
    expect(item.json().name).toBe(NAME);
    const raw = await harness.built.database.db.execute(
      sql`SELECT i.name, l.original_name, r.snapshot FROM items i JOIN logical_files l ON l.item_id = i.id JOIN revisions r ON r.item_id = i.id WHERE i.id = ${id}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain(NAME);
    const revisionId = item.json().currentRevisionId as string;
    const revision = await owner({ method: "GET", url: `/v1/revisions/${revisionId}` });
    expect(revision.statusCode, revision.body).toBe(200);
    expect(revision.json().snapshot).toMatchObject({
      name: NAME,
      file: { originalName: NAME, mediaType: "text/plain" },
    });
    const renamed = await owner({
      method: "PATCH",
      url: `/v1/items/${id}`,
      headers: { "idempotency-key": generateUuidV7() },
      payload: { baseRevisionId: revisionId, name: "Renamed-private-file-sentinel.txt" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const updated = await owner({ method: "GET", url: `/v1/items/${id}` });
    expect(updated.json()).toMatchObject({
      name: "Renamed-private-file-sentinel.txt",
      file: { originalName: NAME, mediaType: "text/plain" },
    });
    const history = await owner({
      method: "GET",
      url: `/v1/revisions/${updated.json().currentRevisionId}`,
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().snapshot).toMatchObject({
      name: "Renamed-private-file-sentinel.txt",
      file: { originalName: NAME, mediaType: "text/plain" },
    });
    const after = await harness.built.database.db.execute(
      sql`SELECT i.name, l.original_name, r.snapshot FROM items i JOIN logical_files l ON l.item_id = i.id JOIN revisions r ON r.item_id = i.id WHERE i.id = ${id}`,
    );
    expect(JSON.stringify(after.rows)).not.toContain(NAME);
    expect(JSON.stringify(after.rows)).not.toContain("Renamed-private-file-sentinel");
  });

  it("protects accepted partial uploads and their metadata without overstating the offset", async () => {
    const created = await owner({
      method: "POST",
      url: "/v1/uploads",
      headers: {
        "upload-length": String(Buffer.byteLength(BODY) + 20),
        "upload-metadata": `filename ${Buffer.from(NAME).toString("base64")},mediaType ${Buffer.from("text/plain").toString("base64")}`,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const location = created.headers["location"] as string;
    const accepted = await owner({
      method: "PATCH",
      url: location,
      payload: Buffer.from(BODY),
      headers: {
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
      },
    });
    expect(accepted.statusCode, accepted.body).toBe(204);
    const status = await owner({ method: "HEAD", url: location });
    expect(status.headers["upload-offset"]).toBe(String(Buffer.byteLength(BODY)));
    expect(await physicalContains(harness.blobRoot, BODY)).toBe(false);
    const raw = await harness.built.database.db.execute(
      sql`SELECT original_name, media_type FROM uploads WHERE id = ${created.json().id}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain(NAME);
  });

  it("restores retained file bytes and metadata as a new revision without moving a duplicate", async () => {
    const id = await directImport();
    const duplicate = await directImport();
    const original = (await owner({ method: "GET", url: `/v1/items/${id}` })).json();
    const boundary = `replace-${generateUuidV7()}`;
    const replacement = "Replacement private bytes sentinel";
    const changed = await owner({
      method: "PUT",
      url: `/v1/files/${id}/content`,
      headers: {
        "idempotency-key": generateUuidV7(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        [
          `--${boundary}\r\nContent-Disposition: form-data; name="baseRevisionId"\r\n\r\n${original.currentRevisionId}\r\n`,
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="replacement.txt"\r\nContent-Type: text/plain\r\n\r\n`,
          replacement,
          `\r\n--${boundary}--\r\n`,
        ].join(""),
      ),
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await owner({ method: "GET", url: `/v1/files/${id}/content` })).body).toBe(replacement);
    expect((await owner({ method: "GET", url: `/v1/files/${duplicate}/content` })).body).toBe(BODY);
    const current = (await owner({ method: "GET", url: `/v1/items/${id}` })).json();
    const restored = await owner({
      method: "POST",
      url: `/v1/revisions/${original.currentRevisionId}/restore`,
      headers: { "idempotency-key": generateUuidV7() },
      payload: { currentRevisionId: current.currentRevisionId },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json().revisionIds).toHaveLength(1);
    expect((await owner({ method: "GET", url: `/v1/files/${id}/content` })).body).toBe(BODY);
    const after = (await owner({ method: "GET", url: `/v1/items/${id}` })).json();
    expect(after.currentRevisionId).not.toBe(original.currentRevisionId);
    expect(after.currentRevisionId).not.toBe(current.currentRevisionId);
    expect(after.file).toMatchObject({ originalName: NAME, byteLength: Buffer.byteLength(BODY) });
    const raw = await harness.built.database.db.execute(
      sql`SELECT i.name, l.original_name, r.snapshot FROM items i JOIN logical_files l ON l.item_id = i.id JOIN revisions r ON r.item_id = i.id WHERE i.id = ${id}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain(NAME);
  });

  it.each(["", BODY])("finalizes and replays a resumable transfer of %s", async (body) => {
    const created = await owner({
      method: "POST",
      url: "/v1/uploads",
      headers: {
        "upload-length": String(Buffer.byteLength(body)),
        "upload-metadata": `filename ${Buffer.from(NAME).toString("base64")}`,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const location = created.headers["location"] as string;
    const finish = () =>
      owner({
        method: "PATCH",
        url: location,
        payload: Buffer.from(body),
        headers: {
          "upload-offset": "0",
          "content-type": "application/offset+octet-stream",
        },
      });
    const first = await finish();
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toEqual({ itemId: created.json().id, verified: true });
    const again = await finish();
    expect(again.statusCode, again.body).toBe(201);
    expect(again.json()).toEqual(first.json());
    const head = await owner({ method: "HEAD", url: location });
    expect(head.statusCode).toBe(200);
    expect(head.headers["upload-complete"]).toBe("true");
    expect(head.headers["upload-offset"]).toBe(String(Buffer.byteLength(body)));
    const download = await owner({ method: "GET", url: `/v1/files/${created.json().id}/content` });
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toBe(body);
    const revisions = await harness.built.database.db.execute(
      sql`SELECT id FROM revisions WHERE item_id = ${created.json().id}`,
    );
    expect(revisions.rows).toHaveLength(1);
  });

  it("refuses a chunk exceeding its declaration while preserving the committed prefix", async () => {
    const created = await owner({
      method: "POST",
      url: "/v1/uploads",
      headers: { "upload-length": "4" },
    });
    const location = created.headers["location"] as string;
    const patch = (body: string, offset: number) =>
      owner({
        method: "PATCH",
        url: location,
        payload: Buffer.from(body),
        headers: {
          "upload-offset": String(offset),
          "content-type": "application/offset+octet-stream",
        },
      });
    expect((await patch("ab", 0)).statusCode).toBe(204);
    const refused = await patch("cde", 2);
    expect(refused.statusCode, refused.body).toBe(400);
    expect((await owner({ method: "HEAD", url: location })).headers["upload-offset"]).toBe("2");
    expect((await patch("cd", 2)).statusCode).toBe(201);
    expect(
      (await owner({ method: "GET", url: `/v1/files/${created.json().id}/content` })).body,
    ).toBe("abcd");
  });
});
