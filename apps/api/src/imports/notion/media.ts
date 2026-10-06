import { lookup } from "node:dns/promises";
import { boundedBytes, object, string } from "./api-client.ts";
import { NotionImportError, SOURCE_LIMITS } from "./source.ts";

export function notionMediaUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443")
    )
      return null;
    if (
      url.hostname === "prod-files-secure.s3.us-west-2.amazonaws.com" ||
      (url.hostname === "s3.us-west-2.amazonaws.com" &&
        url.pathname.startsWith("/secure.notion-static.com/")) ||
      url.hostname === "file.notion.so"
    )
      return url;
  } catch {
    /* Inert unsupported reference. */
  }
  return null;
}
function publicAddress(address: string): boolean {
  // Only validated public IPv4 addresses are admitted; IPv6/mapped and special
  // ranges fail closed. Trusted fixed hosts currently publish public IPv4.
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b] = parts;
  return (
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a !== 169 &&
    a !== 192 &&
    a !== 198 &&
    a !== 203 &&
    (a ?? 256) < 224 &&
    !(a === 172 && (b ?? 0) >= 16 && (b ?? 0) <= 31) &&
    !(a === 100 && (b ?? 0) >= 64 && (b ?? 0) <= 127)
  );
}
export async function downloadNotionMedia(
  raw: string,
  options: {
    signal?: AbortSignal | undefined;
    fetch?: typeof fetch;
    resolve?: (hostname: string) => Promise<readonly { address: string }[]>;
  } = {},
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  let url = notionMediaUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    if (!url) throw new NotionImportError("import.media-host-refused");
    const addresses = await (
      options.resolve ?? ((hostname) => lookup(hostname, { all: true, family: 4 }))
    )(url.hostname);
    if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
      throw new NotionImportError("import.media-host-refused");
    const response = await (options.fetch ?? fetch)(url, {
      redirect: "manual",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      url = location ? notionMediaUrl(new URL(location, url).href) : null;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new NotionImportError("import.media-unavailable");
    }
    return {
      bytes: await boundedBytes(response, SOURCE_LIMITS.fileBytes),
      mediaType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
    };
  }
  throw new NotionImportError("import.media-redirect-limit");
}
export function fileUrl(value: unknown): string {
  const entry = object(value);
  return string(object(entry[string(entry["type"])])["url"]);
}
