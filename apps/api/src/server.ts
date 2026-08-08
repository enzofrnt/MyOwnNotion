/**
 * API entry point. Binds to 127.0.0.1 only (no production exposure before
 * authentication).
 */
import process from "node:process";
import { buildApp, parseStorageOptions } from "./app.ts";

const databaseUrl =
  process.env["DATABASE_URL"] ??
  "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";
const host = process.env["MYOWNNOTION_API_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MYOWNNOTION_API_PORT"] ?? 3001);
const storage = parseStorageOptions(process.env);

const { app, close } = await buildApp({ databaseUrl, storage });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
