import { ListMultipartUploadsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { S3BlobStore } from "@myownnotion/blob-store";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const image = "quay.io/minio/minio:RELEASE.2025-07-23T15-54-02Z";
const accessKeyId = "integration-access";
const secretAccessKey = "integration-secret-protected";
const bucket = `myownnotion-${process.pid}`;
const prefix = "integration";
let container: StartedTestContainer | undefined;
let endpoint: string;
let client: S3Client;
let store: S3BlobStore;

function configuredStore(): S3BlobStore {
  return new S3BlobStore({ bucket, prefix, client });
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const bytes: number[] = [];
  for await (const chunk of source) bytes.push(...chunk);
  return Uint8Array.from(bytes);
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/minio/health/ready`);
      if (response.ok) return;
    } catch {
      // A restart closes the listener briefly.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("object storage did not become ready after restart");
}

beforeAll(async () => {
  container = await new GenericContainer(image)
    .withEnvironment({ MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/ready", 9000).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();
  endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  client = new S3Client({
    endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey },
  });
  store = configuredStore();
  await store.ensureBucket();
}, 180_000);

afterAll(async () => {
  client?.destroy();
  await container?.stop();
});

describe("private S3-compatible streaming parity", () => {
  it("survives restart, streams exact ranges, stays private, and aborts multipart residue", async () => {
    const zero = await store.put(new Uint8Array());
    expect(zero.byteLength).toBe(0);

    const source = new TextEncoder().encode("persistent ranged object bytes");
    const first = await store.put(source);
    const duplicate = await store.put(source);
    expect(duplicate).toMatchObject({ storageKey: first.storageKey, created: false });
    expect(await store.head(first.storageKey)).toEqual({
      storageKey: first.storageKey,
      byteLength: source.byteLength,
    });
    const ranged = await store.open(first.storageKey, { start: 11, endInclusive: 16 });
    expect(new TextDecoder().decode(await collect(ranged?.body ?? (async function* () {})()))).toBe(
      "ranged",
    );

    const anonymous = await fetch(`${endpoint}/${bucket}/${prefix}/${first.storageKey}`);
    expect(anonymous.status).toBe(403);

    await container?.restart({ timeout: 30_000 });
    endpoint = `http://${container?.getHost()}:${container?.getMappedPort(9000)}`;
    client.destroy();
    client = new S3Client({
      endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId, secretAccessKey },
    });
    await waitForReady();
    store = configuredStore();
    expect(await store.get(first.storageKey)).toEqual(source);

    async function* interrupted(): AsyncIterable<Uint8Array> {
      yield new Uint8Array(9 * 1024 * 1024).fill(4);
      throw new Error("source interrupted");
    }
    await expect(store.put(interrupted())).rejects.toThrow("source interrupted");
    const [objects, multipart] = await Promise.all([
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/.tmp/` })),
      client.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: `${prefix}/.tmp/` })),
    ]);
    expect(objects.Contents ?? []).toHaveLength(0);
    expect(multipart.Uploads ?? []).toHaveLength(0);
    expect(await store.list()).toEqual([first.storageKey, zero.storageKey].sort());

    await container?.stop({ remove: true, removeVolumes: true });
    container = undefined;
    let unavailable = false;
    try {
      await store.head(first.storageKey);
    } catch {
      unavailable = true;
    }
    expect(unavailable).toBe(true);
  }, 120_000);
});
