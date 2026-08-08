import { isUuid, MAX_OFFLINE_FILE_BYTE_LENGTH } from "@myownnotion/domain";

const FILE_CONTENT_PATH = /^\/v1\/files\/([^/]+)\/content$/;

export function isRevisionQualifiedFileRequest(input: {
  readonly url: URL;
  readonly request: Pick<Request, "method" | "headers">;
}): boolean {
  if (input.request.method !== "GET" || input.request.headers.has("range")) return false;
  const itemId = FILE_CONTENT_PATH.exec(input.url.pathname)?.[1];
  const revisionId = input.url.searchParams.get("revisionId");
  return isUuid(itemId) && isUuid(revisionId) && input.url.searchParams.size === 1;
}

export function admitCompleteFileResponse(response: Response): boolean {
  if (response.status !== 200 || response.headers.has("content-range")) return false;
  const contentLength = Number(response.headers.get("content-length"));
  const contentId = response.headers.get("x-content-id");
  const revisionId = response.headers.get("x-file-revision-id");
  const digest = response.headers.get("x-content-sha256");
  const cacheControl = response.headers.get("cache-control") ?? "";
  return (
    Number.isSafeInteger(contentLength) &&
    contentLength >= 0 &&
    contentLength <= MAX_OFFLINE_FILE_BYTE_LENGTH &&
    isUuid(contentId) &&
    isUuid(revisionId) &&
    digest !== null &&
    /^[a-f0-9]{64}$/.test(digest) &&
    cacheControl.includes("private") &&
    cacheControl.includes("immutable")
  );
}
