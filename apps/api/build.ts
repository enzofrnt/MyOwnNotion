import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";

const appRoot = import.meta.dir;
const sourceRoot = path.join(appRoot, "src");
const outdir = path.join(appRoot, "dist");
const loroBundlerEntry = Bun.resolveSync("loro-crdt/bundler", appRoot);
const loroBundlerWasmLoader = path.join(path.dirname(loroBundlerEntry), "loro_wasm.js");
const loroCwdRelativeUrl = "const url = Bun.pathToFileURL(wasmModuleOrExports);";
const loroBundleRelativeUrl = "const url = new URL(wasmModuleOrExports, import.meta.url);";

const loroBundlerRuntime: Bun.BunPlugin = {
  name: "loro-bundler-runtime",
  setup(builder) {
    // The Node export reads its Wasm next to node_modules at runtime. The
    // bundler export instead lets Bun emit a relocation-safe Wasm asset, which
    // keeps the production image independent from the build-host filesystem.
    builder.onResolve({ filter: /^loro-crdt$/ }, () => ({ path: loroBundlerEntry }));
    builder.onLoad({ filter: /loro_wasm\.js$/ }, async (args) => {
      if (args.path !== loroBundlerWasmLoader) {
        return undefined;
      }
      const contents = await readFile(args.path, "utf8");
      if (!contents.includes(loroCwdRelativeUrl)) {
        throw new Error("The expected Loro Bun Wasm URL loader changed");
      }
      return {
        contents: contents.replace(loroCwdRelativeUrl, loroBundleRelativeUrl),
        loader: "js",
      };
    });
  },
};

await rm(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    path.join(sourceRoot, "server.ts"),
    path.join(sourceRoot, "migrate.ts"),
    path.join(sourceRoot, "admin", "admin-cli.ts"),
  ],
  root: sourceRoot,
  outdir,
  target: "bun",
  format: "esm",
  packages: "bundle",
  plugins: [loroBundlerRuntime],
  splitting: false,
  sourcemap: "external",
  env: "disable",
  naming: {
    entry: "[dir]/[name].js",
    chunk: "chunks/[name]-[hash].js",
    asset: "assets/[name]-[hash].[ext]",
  },
});

for (const log of result.logs) {
  console.error(log);
}
if (!result.success) {
  throw new Error("Bun could not build the API production entries");
}

for (const relativePath of [
  "server.js",
  "server.js.map",
  "migrate.js",
  "migrate.js.map",
  "admin/admin-cli.js",
  "admin/admin-cli.js.map",
]) {
  await access(path.join(outdir, relativePath));
}

const wasmOutput = result.outputs.find((output) => output.path.endsWith(".wasm"));
if (wasmOutput === undefined) {
  throw new Error("The API production build did not emit the Loro Wasm runtime");
}

const bundledJavaScript = await Promise.all(
  result.outputs
    .filter((output) => output.path.endsWith(".js"))
    .map((output) => readFile(output.path, "utf8")),
);
if (bundledJavaScript.some((source) => source.includes("nodejs/loro_wasm_bg.wasm"))) {
  throw new Error("The API production build retained Loro's node_modules Wasm loader");
}

// Bun gives every inlined module the bundle's import.meta.filename. A nested
// CLI that still owns a direct-run guard can therefore execute alongside the
// real entrypoint. Exercise the built artifact so that regression cannot ship.
const adminHelp = Bun.spawnSync({
  cmd: [process.execPath, path.join(outdir, "admin", "admin-cli.js"), "--help"],
  cwd: appRoot,
  stdout: "pipe",
  stderr: "pipe",
});
const adminHelpOutput = new TextDecoder().decode(adminHelp.stdout);
if (
  adminHelp.exitCode !== 0 ||
  !adminHelpOutput.includes("myownnotion — local administration") ||
  adminHelpOutput.includes("myownnotion security —")
) {
  throw new Error("The bundled admin entrypoint does not execute exactly once");
}

console.info(`Built ${result.outputs.length} API artifacts with Bun ${Bun.version}.`);
