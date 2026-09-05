import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dirname;
const outdir = process.env["MYOWNNOTION_DESKTOP_BUILD_OUTDIR"] ?? path.join(root, ".vite/build");
const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
  version: string;
};
await mkdir(outdir, { recursive: true });
for (const [entry, format, filename] of [
  ["bootstrap", "esm", "bootstrap.js"],
  ["main", "esm", "main.js"],
  ["preload", "cjs", "preload.cjs"],
] as const) {
  const result = await Bun.build({
    entrypoints: [path.join(root, "src", `${entry}.ts`)],
    outdir,
    naming: filename,
    target: "node",
    format,
    external: ["electron"],
    define: {
      __DESKTOP_VERSION__: JSON.stringify(metadata.version),
      __DESKTOP_UPDATE_PUBLIC_KEY__: JSON.stringify(process.env["DESKTOP_UPDATE_PUBLIC_KEY"] ?? ""),
    },
    sourcemap: "external",
  });
  if (!result.success) throw new AggregateError(result.logs, `Desktop ${entry} build failed`);
}
