import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";
import { authenticatedContent } from "./helpers/content-owner.ts";

let harness: ApiHarness;
let owner: Awaited<ReturnType<typeof authenticatedContent>>;
let keyRoot: string;
const BODY = "Private attachment content sentinel from secured HTTP upload";
const NAME = "Private-confidential-filename-sentinel.txt";
beforeAll(async () => {
  keyRoot = await mkdtemp(path.join(os.tmpdir(), "mon-protected-http-key-"));
  const keyFile = path.join(keyRoot, "deployment-key");
  await writeFile(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
  });
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

async function directImport(): Promise<string> {
  const boundary = `mon-${generateUuidV7()}`;
  const payload = Buffer.from(
    [
      `--${boundary}\r\nContent-Disposition: form-data; name="placement"\r\n\r\n`,
      '{"kind":"hierarchy","parentItemId":null,"positionKey":"V"}\r\n',
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${NAME}"\r\nContent-Type: text/plain\r\n\r\n`,
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
});
