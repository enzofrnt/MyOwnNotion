import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import tailwind from "bun-plugin-tailwind";
import { injectManifest } from "workbox-build";

const appRoot = import.meta.dir;
const outdir = path.join(appRoot, "dist");
const e2eBuild = process.env["MYOWNNOTION_E2E_BUILD"] === "1";

function publicUrl(absolutePath: string): string {
  return `/${path.relative(outdir, absolutePath).split(path.sep).join("/")}`;
}

function printLogs(result: Bun.BuildOutput): void {
  for (const log of result.logs) {
    console.error(log);
  }
}

async function requireSuccessfulBuild(
  label: string,
  result: Bun.BuildOutput,
): Promise<Bun.BuildOutput> {
  printLogs(result);
  if (!result.success) {
    throw new Error(`Bun could not build ${label}`);
  }
  return result;
}

await rm(outdir, { recursive: true, force: true });

const workerBuild = await requireSuccessfulBuild(
  "the search worker",
  await Bun.build({
    entrypoints: [path.join(appRoot, "src", "features", "search", "search.worker.ts")],
    outdir,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    env: "disable",
    naming: {
      entry: "assets/search.worker-[hash].[ext]",
    },
  }),
);
const workerOutput = workerBuild.outputs.find(
  (output) => output.kind === "entry-point" && output.path.endsWith(".js"),
);
if (workerOutput === undefined) {
  throw new Error("The Bun build did not emit the search worker entry");
}
const workerUrl = publicUrl(workerOutput.path);

const applicationBuild = await requireSuccessfulBuild(
  "the web application",
  await Bun.build({
    entrypoints: [path.join(appRoot, "index.html")],
    outdir,
    target: "browser",
    format: "esm",
    // Loro's nested browser/development export is its bundler entry. It lets
    // Bun emit the Wasm asset instead of leaving a source-relative URL behind.
    conditions: ["browser", "development"],
    splitting: true,
    minify: true,
    sourcemap: "external",
    publicPath: "/",
    plugins: [tailwind],
    env: "disable",
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(process.env["MYOWNNOTION_API_URL"] ?? ""),
      "import.meta.env.PROD": "true",
      "import.meta.env.DEV": "false",
      "process.env.NODE_ENV": '"production"',
      __MYOWNNOTION_E2E__: JSON.stringify(e2eBuild),
      __MYOWNNOTION_SEARCH_WORKER_URL__: JSON.stringify(workerUrl),
    },
    naming: {
      entry: "[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
  }),
);

await requireSuccessfulBuild(
  "the service worker",
  await Bun.build({
    entrypoints: [path.join(appRoot, "src", "service-worker.ts")],
    outdir,
    target: "browser",
    format: "iife",
    minify: true,
    sourcemap: "external",
    env: "disable",
    naming: {
      entry: "service-worker.js",
    },
  }),
);

const serviceWorkerPath = path.join(outdir, "service-worker.js");
const injected = await injectManifest({
  swSrc: serviceWorkerPath,
  swDest: serviceWorkerPath,
  globDirectory: outdir,
  globPatterns: ["**/*.{js,css,html,svg,woff2,wasm,webmanifest}"],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});
if (injected.count === 0) {
  throw new Error("Workbox did not inject any application-shell asset");
}

await access(path.join(outdir, "index.html"));
await access(serviceWorkerPath);
const emittedFiles = [...new Bun.Glob("**/*").scanSync({ cwd: outdir, onlyFiles: true })];
for (const required of [
  emittedFiles.some((file) => file.endsWith(".css")),
  emittedFiles.some((file) => file.endsWith(".wasm")),
  emittedFiles.some((file) => file.endsWith(".webmanifest")),
  emittedFiles.some((file) => /^assets\/search\.worker-.+\.js$/.test(file)),
]) {
  if (!required) {
    throw new Error("The web production build is missing a required asset class");
  }
}

const javascript = await Promise.all(
  emittedFiles
    .filter((file) => file.endsWith(".js") && file !== "service-worker.js")
    .map((file) => readFile(path.join(outdir, file), "utf8")),
);
if (!javascript.some((source) => source.includes(workerUrl))) {
  throw new Error("The web application does not reference the emitted search worker");
}
const hasE2ETestHook = javascript.some((source) =>
  source.includes("__MYOWNNOTION_E2E_LOCAL_CONTENT__"),
);
if (hasE2ETestHook !== e2eBuild) {
  throw new Error(
    e2eBuild
      ? "The E2E build is missing its local-content fixture hook"
      : "The production build contains an E2E-only fixture hook",
  );
}
const registersServiceWorker = javascript.some((source) =>
  source.includes('register("/service-worker.js")'),
);
if (registersServiceWorker === e2eBuild) {
  throw new Error(
    e2eBuild
      ? "The E2E build registers a service worker that bypasses Playwright request routes"
      : "The production build does not register its service worker",
  );
}

console.info(
  `Built ${applicationBuild.outputs.length} web outputs and precached ${injected.count} assets (${injected.size} bytes) with Bun ${Bun.version}.`,
);
