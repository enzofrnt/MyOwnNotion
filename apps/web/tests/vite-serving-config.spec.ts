import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { preview } from "vite";
import { afterEach, expect, it, vi } from "vitest";

function readRawModule(port: number) {
  return new Promise<{
    body: Buffer;
    encoding: string | undefined;
    statusCode: number | undefined;
  }>((resolve, reject) => {
    const call = request(
      {
        agent: false,
        headers: { "Accept-Encoding": "gzip", Connection: "close" },
        hostname: "127.0.0.1",
        path: "/assets/app-router.js",
        port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            encoding: response.headers["content-encoding"],
            statusCode: response.statusCode,
          }),
        );
        response.on("error", reject);
      },
    );
    call.on("error", reject);
    call.end();
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("resolves preview paths with spaces and native host/port values without shell interpolation", async () => {
  vi.stubEnv("MYOWNNOTION_WEB_HOST", "localhost");
  vi.stubEnv("MYOWNNOTION_WEB_PORT", "5473");
  vi.stubEnv("MYOWNNOTION_WEB_DIST_DIR", "C:\\fixture root\\compiled web");
  vi.resetModules();
  const { default: config } = await import("../vite.config.ts");
  expect(config.build?.outDir).toBe("C:\\fixture root\\compiled web");
  expect(config.preview).toMatchObject({ host: "localhost", port: 5473, strictPort: true });
  expect(config.server).toMatchObject({ host: "localhost", port: 5473, strictPort: true });
});

it("keeps default serving local and retains the explicit container proxy binding", async () => {
  vi.stubEnv("MYOWNNOTION_WEB_HOST", "");
  vi.stubEnv("MYOWNNOTION_WEB_PORT", "");
  vi.stubEnv("MYOWNNOTION_WEB_DIST_DIR", "");
  vi.stubEnv("MYOWNNOTION_DEV_HTTPS_PROXY", "1");
  vi.resetModules();
  const { default: config } = await import("../vite.config.ts");
  expect(config.build?.outDir).toBe("dist");
  expect(config.preview).toMatchObject({ host: "127.0.0.1", port: 5173, strictPort: true });
  expect(config.server?.host).toBe("0.0.0.0");
});

it("disables Vite response compression only for the isolated E2E preview", async () => {
  vi.stubEnv("MYOWNNOTION_E2E_PREVIEW_IDENTITY_ENCODING", "");
  vi.resetModules();
  const { default: ordinaryConfig } = await import("../vite.config.ts");
  expect(ordinaryConfig.preview?.headers).toBeUndefined();

  vi.stubEnv("MYOWNNOTION_E2E_PREVIEW_IDENTITY_ENCODING", "1");
  vi.resetModules();
  const { default: config } = await import("../vite.config.ts");
  expect(config.preview?.headers).toEqual({ "Content-Encoding": "identity" });
  expect(config.server?.headers).toBeUndefined();
});

it("serves E2E modules byte-for-byte while ordinary preview remains compressed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "myownnotion-vite-preview-"));
  const servers: Awaited<ReturnType<typeof preview>>[] = [];
  const moduleBytes = Buffer.from(
    `export default ${JSON.stringify("0123456789abcdef".repeat(32_000))};\n`,
  );

  try {
    const dist = path.join(root, "dist");
    await mkdir(path.join(dist, "assets"), { recursive: true });
    await writeFile(path.join(dist, "index.html"), '<script src="/assets/app-router.js"></script>');
    await writeFile(path.join(dist, "assets", "app-router.js"), moduleBytes);

    const startPreview = async (headers: Record<string, string> | undefined) => {
      const server = await preview({
        build: { outDir: "dist" },
        configFile: false,
        logLevel: "silent",
        preview: { headers, host: "127.0.0.1", port: 0, strictPort: true },
        root,
      });
      servers.push(server);
      const address = server.httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Vite preview did not expose a TCP port");
      }
      return address.port;
    };

    const ordinaryPort = await startPreview(undefined);
    const ordinary = await readRawModule(ordinaryPort);
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.encoding).toBe("gzip");
    expect(gunzipSync(ordinary.body)).toEqual(moduleBytes);
    await servers.pop()?.close();

    vi.stubEnv("MYOWNNOTION_E2E_PREVIEW_IDENTITY_ENCODING", "1");
    vi.resetModules();
    const { default: config } = await import("../vite.config.ts");
    const e2ePort = await startPreview(config.preview?.headers);
    const e2e = await readRawModule(e2ePort);
    expect(e2e.statusCode).toBe(200);
    expect(e2e.encoding).toBe("identity");
    expect(e2e.body).toEqual(moduleBytes);
  } finally {
    await Promise.all(servers.map((server) => server.close()));
    await rm(root, { force: true, recursive: true });
  }
});
