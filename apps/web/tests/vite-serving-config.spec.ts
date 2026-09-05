import { afterEach, expect, it, vi } from "vitest";

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
