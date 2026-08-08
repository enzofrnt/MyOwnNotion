import { describe, expect, it } from "vitest";
import { parseStorageOptions } from "../src/app.ts";

describe("protected blob-storage configuration", () => {
  it("keeps the dependency-light filesystem adapter as the default", () => {
    expect(parseStorageOptions({ MYOWNNOTION_BLOB_ROOT: "/tmp/private-blobs" })).toEqual({
      kind: "filesystem",
      root: "/tmp/private-blobs",
    });
  });

  it("accepts one exact private S3 configuration", () => {
    expect(
      parseStorageOptions({
        MYOWNNOTION_STORAGE_ADAPTER: "s3",
        MYOWNNOTION_S3_ENDPOINT: "http://object-storage:9000",
        MYOWNNOTION_S3_REGION: "us-east-1",
        MYOWNNOTION_S3_BUCKET: "myownnotion-private",
        MYOWNNOTION_S3_ACCESS_KEY: "application-access",
        MYOWNNOTION_S3_SECRET_KEY: "protected-secret",
        MYOWNNOTION_S3_PREFIX: "content",
      }),
    ).toEqual({
      kind: "s3",
      endpoint: "http://object-storage:9000",
      region: "us-east-1",
      bucket: "myownnotion-private",
      accessKeyId: "application-access",
      secretAccessKey: "protected-secret",
      prefix: "content",
    });
  });

  it.each([
    [{ MYOWNNOTION_STORAGE_ADAPTER: "memory" }, "adapter"],
    [{ MYOWNNOTION_STORAGE_ADAPTER: "s3" }, "endpoint"],
    [
      {
        MYOWNNOTION_STORAGE_ADAPTER: "s3",
        MYOWNNOTION_S3_ENDPOINT: "ftp://private.example",
        MYOWNNOTION_S3_BUCKET: "myownnotion-private",
        MYOWNNOTION_S3_ACCESS_KEY: "access",
        MYOWNNOTION_S3_SECRET_KEY: "never-print-this",
      },
      "endpoint",
    ],
  ])("rejects invalid configuration without echoing protected values", (environment, field) => {
    expect(() => parseStorageOptions(environment)).toThrow(field);
    try {
      parseStorageOptions(environment);
    } catch (error) {
      expect(String(error)).not.toContain("never-print-this");
    }
  });
});
