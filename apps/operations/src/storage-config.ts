import { type BlobStore, FilesystemBlobStore, S3BlobStore } from "@myownnotion/blob-store";

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${name.toLowerCase()} is required`);
  }
  return value;
}

/** Creates only private adapters and never includes protected values in errors. */
export async function createConfiguredBlobStore(environment: Environment): Promise<BlobStore> {
  const adapter = environment["MYOWNNOTION_STORAGE_ADAPTER"]?.trim() || "filesystem";
  if (adapter === "filesystem") {
    return new FilesystemBlobStore(environment["MYOWNNOTION_BLOB_ROOT"]?.trim() || "./.dev-blobs");
  }
  if (adapter !== "s3") {
    throw new TypeError("storage adapter is invalid");
  }
  const endpoint = required(environment, "MYOWNNOTION_S3_ENDPOINT");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new TypeError("s3 endpoint is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("s3 endpoint is invalid");
  }
  const store = new S3BlobStore({
    bucket: required(environment, "MYOWNNOTION_S3_BUCKET"),
    prefix: environment["MYOWNNOTION_S3_PREFIX"]?.trim() || "blobs",
    clientConfig: {
      endpoint: url.toString().replace(/\/$/, ""),
      region: environment["MYOWNNOTION_S3_REGION"]?.trim() || "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: required(environment, "MYOWNNOTION_S3_ACCESS_KEY"),
        secretAccessKey: required(environment, "MYOWNNOTION_S3_SECRET_KEY"),
      },
    },
  });
  await store.ensureBucket();
  return store;
}
