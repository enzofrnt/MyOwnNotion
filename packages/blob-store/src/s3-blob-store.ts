import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  type BlobHead,
  type BlobListOptions,
  type BlobRange,
  type BlobSource,
  type BlobStore,
  type BlobWriteOptions,
  blobChunks,
  collectBlob,
  equalBlobStreams,
  type OpenedBlob,
  type StoredBlob,
} from "./blob-store.ts";

const STORAGE_KEY_PATTERN = /^[a-f0-9]{64}(?:-[a-f0-9-]{36})?$/;

export interface S3BlobStoreOptions {
  readonly bucket: string;
  readonly prefix?: string;
  readonly client?: S3Client;
  readonly clientConfig?: S3ClientConfig;
}

function missingObject(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function validateRange(range: BlobRange): void {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.endInclusive) ||
    range.start < 0 ||
    range.endInclusive < range.start
  ) {
    throw new RangeError("invalid blob range");
  }
}

function copySource(bucket: string, key: string): string {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export class S3BlobStore implements BlobStore {
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #client: S3Client;

  constructor(options: S3BlobStoreOptions) {
    this.#bucket = options.bucket;
    this.#prefix = options.prefix?.replace(/^\/+|\/+$/g, "") ?? "blobs";
    this.#client = options.client ?? new S3Client(options.clientConfig ?? {});
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
    } catch (error) {
      if (!missingObject(error)) {
        throw error;
      }
      await this.#client.send(new CreateBucketCommand({ Bucket: this.#bucket }));
    }
  }

  async put(source: BlobSource, options: BlobWriteOptions = {}): Promise<StoredBlob> {
    const temporaryKey = `${this.#prefix}/.tmp/${randomUUID()}`;
    const hash = createHash("sha256");
    let byteLength = 0;
    const hashingSource = async function* (): AsyncIterable<Uint8Array> {
      for await (const chunk of blobChunks(source)) {
        byteLength += chunk.byteLength;
        if (options.maxByteLength !== undefined && byteLength > options.maxByteLength) {
          throw new RangeError("blob exceeds maximum byte length");
        }
        hash.update(chunk);
        yield chunk;
      }
    };

    const upload = new Upload({
      client: this.#client,
      params: {
        Bucket: this.#bucket,
        Key: temporaryKey,
        Body: Readable.from(hashingSource()),
        ContentType: "application/octet-stream",
      },
      leavePartsOnError: false,
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
    });
    try {
      await upload.done();
    } catch (error) {
      await upload.abort().catch(() => undefined);
      await this.#deleteObjectKey(temporaryKey).catch(() => undefined);
      throw error;
    }

    const digest = hash.digest();
    const hex = digest.toString("hex");
    const persisted = await this.#hashObject(temporaryKey);
    if (persisted.hex !== hex || persisted.byteLength !== byteLength) {
      await this.#deleteObjectKey(temporaryKey);
      throw new Error("blob verification failed after write");
    }

    let storageKey = hex;
    let finalKey = this.#objectKey(storageKey);
    const existing = await this.#headObjectKey(finalKey);
    if (existing !== null) {
      if (
        existing.byteLength === byteLength &&
        (await this.#compareObjectKeys(finalKey, temporaryKey))
      ) {
        await this.#deleteObjectKey(temporaryKey);
        return {
          storageKey,
          sha256: new Uint8Array(digest),
          byteLength,
          verifiedAt: new Date(),
          created: false,
        };
      }
      storageKey = `${hex}-${randomUUID()}`;
      finalKey = this.#objectKey(storageKey);
    }

    try {
      await this.#client.send(
        new CopyObjectCommand({
          Bucket: this.#bucket,
          Key: finalKey,
          CopySource: copySource(this.#bucket, temporaryKey),
          ContentType: "application/octet-stream",
          MetadataDirective: "REPLACE",
        }),
      );
      const copied = await this.#hashObject(finalKey);
      if (copied.hex !== hex || copied.byteLength !== byteLength) {
        await this.#deleteObjectKey(finalKey);
        throw new Error("blob verification failed after copy");
      }
    } finally {
      await this.#deleteObjectKey(temporaryKey).catch(() => undefined);
    }

    return {
      storageKey,
      sha256: new Uint8Array(digest),
      byteLength,
      verifiedAt: new Date(),
      created: true,
    };
  }

  async putVerifiedAt(
    storageKey: string,
    source: BlobSource,
    options: BlobWriteOptions = {},
  ): Promise<StoredBlob> {
    this.#validateStorageKey(storageKey);
    const stored = await this.put(source, options);
    const digestHex = Buffer.from(stored.sha256).toString("hex");
    if (storageKey !== digestHex && !storageKey.startsWith(`${digestHex}-`)) {
      if (stored.created) await this.delete(stored.storageKey);
      throw new Error("blob digest does not match canonical storage key");
    }
    if (stored.storageKey === storageKey) return stored;

    const sourceKey = this.#objectKey(stored.storageKey);
    const targetKey = this.#objectKey(storageKey);
    let targetCreated = false;
    try {
      if ((await this.#headObjectKey(targetKey)) === null) {
        await this.#client.send(
          new CopyObjectCommand({
            Bucket: this.#bucket,
            Key: targetKey,
            CopySource: copySource(this.#bucket, sourceKey),
            ContentType: "application/octet-stream",
            MetadataDirective: "REPLACE",
          }),
        );
        targetCreated = true;
      }
      const copied = await this.#hashObject(targetKey);
      if (copied.hex !== digestHex || copied.byteLength !== stored.byteLength) {
        if (targetCreated) await this.#deleteObjectKey(targetKey);
        throw new Error("canonical blob key contains different bytes");
      }
      return { ...stored, storageKey, created: targetCreated };
    } finally {
      if (stored.created) await this.#deleteObjectKey(sourceKey).catch(() => undefined);
    }
  }

  async head(storageKey: string): Promise<BlobHead | null> {
    this.#validateStorageKey(storageKey);
    return this.#headObjectKey(this.#objectKey(storageKey)).then((metadata) =>
      metadata === null ? null : { storageKey, byteLength: metadata.byteLength },
    );
  }

  async open(storageKey: string, range?: BlobRange): Promise<OpenedBlob | null> {
    this.#validateStorageKey(storageKey);
    if (range !== undefined) {
      validateRange(range);
    }
    const metadata = await this.head(storageKey);
    if (metadata === null) {
      return null;
    }
    if (range !== undefined && range.start >= metadata.byteLength) {
      throw new RangeError("unsatisfiable blob range");
    }
    const effectiveRange =
      range === undefined
        ? null
        : {
            start: range.start,
            endInclusive: Math.min(range.endInclusive, metadata.byteLength - 1),
          };
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.#objectKey(storageKey),
        ...(effectiveRange === null
          ? {}
          : { Range: `bytes=${effectiveRange.start}-${effectiveRange.endInclusive}` }),
      }),
    );
    if (response.Body === undefined) {
      throw new Error("object response has no body");
    }
    const contentLength =
      effectiveRange === null
        ? metadata.byteLength
        : effectiveRange.endInclusive - effectiveRange.start + 1;
    return {
      ...metadata,
      contentLength,
      range: effectiveRange,
      body: response.Body as AsyncIterable<Uint8Array>,
    };
  }

  async list(options: BlobListOptions = {}): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: `${this.#prefix}/`,
          ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
        }),
      );
      for (const object of response.Contents ?? []) {
        const key = object.Key;
        if (key === undefined) {
          continue;
        }
        const storageKey = key.slice(this.#prefix.length + 1);
        if (storageKey.startsWith(".tmp/")) {
          if (options.includeTemporary === true) {
            keys.push(storageKey);
          }
          continue;
        }
        if (STORAGE_KEY_PATTERN.test(storageKey)) {
          keys.push(storageKey);
        }
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);
    return keys.sort();
  }

  async compare(leftStorageKey: string, rightStorageKey: string): Promise<boolean> {
    const [left, right] = await Promise.all([
      this.open(leftStorageKey),
      this.open(rightStorageKey),
    ]);
    if (left === null || right === null || left.byteLength !== right.byteLength) {
      return false;
    }
    return equalBlobStreams(left.body, right.body);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    const opened = await this.open(storageKey);
    return opened === null ? null : collectBlob(opened.body);
  }

  async equals(storageKey: string, candidate: Uint8Array): Promise<boolean> {
    const opened = await this.open(storageKey);
    if (opened === null || opened.byteLength !== candidate.byteLength) {
      return false;
    }
    return equalBlobStreams(
      opened.body,
      (async function* () {
        yield candidate;
      })(),
    );
  }

  async delete(storageKey: string): Promise<void> {
    this.#validateStorageKey(storageKey);
    await this.#deleteObjectKey(this.#objectKey(storageKey));
  }

  #objectKey(storageKey: string): string {
    return `${this.#prefix}/${storageKey}`;
  }

  #validateStorageKey(storageKey: string): void {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new RangeError("invalid storage key");
    }
  }

  async #headObjectKey(key: string): Promise<{ byteLength: number } | null> {
    try {
      const response = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      const byteLength = response.ContentLength;
      if (byteLength === undefined || !Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new Error("object has invalid content length");
      }
      return { byteLength };
    } catch (error) {
      if (missingObject(error)) {
        return null;
      }
      throw error;
    }
  }

  async #openObjectKey(key: string): Promise<AsyncIterable<Uint8Array> | null> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      return response.Body === undefined ? null : (response.Body as AsyncIterable<Uint8Array>);
    } catch (error) {
      if (missingObject(error)) {
        return null;
      }
      throw error;
    }
  }

  async #compareObjectKeys(leftKey: string, rightKey: string): Promise<boolean> {
    const [leftHead, rightHead] = await Promise.all([
      this.#headObjectKey(leftKey),
      this.#headObjectKey(rightKey),
    ]);
    if (leftHead === null || rightHead === null || leftHead.byteLength !== rightHead.byteLength) {
      return false;
    }
    const [left, right] = await Promise.all([
      this.#openObjectKey(leftKey),
      this.#openObjectKey(rightKey),
    ]);
    return left !== null && right !== null && equalBlobStreams(left, right);
  }

  async #hashObject(key: string): Promise<{ hex: string; byteLength: number }> {
    const body = await this.#openObjectKey(key);
    if (body === null) {
      throw new Error("stored object is missing");
    }
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of body) {
      hash.update(chunk);
      byteLength += chunk.byteLength;
    }
    return { hex: hash.digest("hex"), byteLength };
  }

  async #deleteObjectKey(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}
