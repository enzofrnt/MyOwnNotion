import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSecurityConfig } from "../../src/security/security-config.ts";
import { createApiHarness } from "./app.ts";
import { authenticatedContent } from "./content-owner.ts";

/** Real encryption keys and owner/CSRF requests for attachment route fixtures. */
export async function createProtectedFileHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mon-file-fixture-key-"));
  const keyFile = path.join(root, "deployment-key");
  try {
    await writeFile(keyFile, randomBytes(32).toString("base64"), { mode: 0o600 });
    const api = await createApiHarness({
      security: loadSecurityConfig({
        MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
        MYOWNNOTION_API_HOST: "127.0.0.1",
        MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
        MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
      }),
    });
    try {
      const owner = await authenticatedContent(api);
      return {
        ...api,
        owner,
        requestHeaders: owner.headers,
        close: async () => {
          try {
            await api.close();
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      await api.close();
      throw error;
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
