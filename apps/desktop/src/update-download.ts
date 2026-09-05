import { createHash, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { DesktopUpdateManifest } from "./update-manifest.ts";
import type { UpdateDriver } from "./updates.ts";

export const RELEASE_ROOT = "https://github.com/enzofrnt/MyOwnNotion/releases";
const MAX_INSTALLER = 1024 * 1024 * 1024;
const REDIRECT_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

export function artifactName(manifest: DesktopUpdateManifest): string {
  const extension = { darwin: "dmg", win32: "exe", linux: "AppImage" }[manifest.platform];
  return `MyOwnNotion-${manifest.version}-${manifest.platform}-${manifest.architecture}.${extension}`;
}
export function trustedArtifact(manifest: DesktopUpdateManifest): boolean {
  return (
    manifest.artifactUrl ===
      `${RELEASE_ROOT}/download/v${manifest.version}/${artifactName(manifest)}` &&
    manifest.releaseNotesUrl === `${RELEASE_ROOT}/tag/v${manifest.version}`
  );
}

async function response(url: string, signal: AbortSignal): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !REDIRECT_HOSTS.has(parsed.hostname)
    )
      throw new Error("Untrusted update origin");
    const result = await fetch(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.get("location");
      await result.body?.cancel();
      if (!location) throw new Error("Missing redirect");
      url = new URL(location, url).href;
      continue;
    }
    if (!result.ok || !result.body) throw new Error("Update download unavailable");
    return result;
  }
  throw new Error("Too many redirects");
}
async function bytes(url: string, max: number): Promise<Buffer> {
  const result = await response(url, AbortSignal.timeout(30_000));
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!result.body) throw new Error("Missing download body");
  for await (const chunk of streamChunks(result.body)) {
    size += chunk.length;
    if (size > max) throw new Error("Update metadata too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function authenticatedManifest(
  payload: Uint8Array,
  signature: Uint8Array,
  publicKey: string,
): unknown {
  if (!publicKey || !verify(null, payload, publicKey, signature))
    throw new Error("Invalid update signature");
  return JSON.parse(Buffer.from(payload).toString("utf8"));
}
export async function verifyDownloadedFile(
  file: string,
  manifest: DesktopUpdateManifest,
): Promise<void> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const encoding = /^[a-f0-9]{128}$/i.test(manifest.artifactSha512) ? "hex" : "base64";
  if (!hash.digest().equals(Buffer.from(manifest.artifactSha512, encoding)))
    throw new Error("Installer digest mismatch");
}

export function createUpdateDriver(input: {
  host: UpdateDriver["host"];
  publicKey: string;
  directory: string;
  launch: (file: string, manifest: DesktopUpdateManifest) => Promise<void>;
}): UpdateDriver {
  return {
    host: input.host,
    async manifest() {
      const name = `desktop-${input.host.platform}-${input.host.architecture}.json`;
      const root = `${RELEASE_ROOT}/latest/download/${name}`;
      const [payload, signature] = await Promise.all([
        bytes(root, 16384),
        bytes(`${root}.sig`, 128),
      ]);
      return authenticatedManifest(payload, signature, input.publicKey);
    },
    async download(manifest) {
      if (!trustedArtifact(manifest)) throw new Error("Untrusted installer");
      await mkdir(input.directory, { recursive: true, mode: 0o700 });
      const target = path.join(input.directory, artifactName(manifest));
      const temporary = `${target}.${crypto.randomUUID()}.partial`;
      try {
        const result = await response(manifest.artifactUrl, AbortSignal.timeout(15 * 60_000));
        const file = await open(temporary, "wx", 0o600);
        try {
          let size = 0;
          if (!result.body) throw new Error("Missing download body");
          for await (const chunk of streamChunks(result.body)) {
            size += chunk.length;
            if (size > MAX_INSTALLER) throw new Error("Installer too large");
            await file.writeFile(chunk);
          }
          await file.sync();
        } finally {
          await file.close();
        }
        await verifyDownloadedFile(temporary, manifest);
        await rename(temporary, target);
        return target;
      } finally {
        await rm(temporary, { force: true });
      }
    },
    async launch(file, manifest) {
      if (file !== path.join(input.directory, artifactName(manifest)) || !trustedArtifact(manifest))
        throw new Error("Invalid installer");
      await verifyDownloadedFile(file, manifest);
      await input.launch(file, manifest);
    },
  };
}

async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return;
      yield value.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
