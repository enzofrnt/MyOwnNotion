import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tailwind from "bun-plugin-tailwind";
import { injectManifest } from "workbox-build";
import { requireWebAssetClasses } from "./build-assets";

const appRoot = import.meta.dir;
const e2eBuild = process.env["MYOWNNOTION_E2E_BUILD"] === "1";

function outputDirectory(): string {
  const requested = process.env["MYOWNNOTION_E2E_WEB_OUTDIR"];
  if (requested === undefined) return path.join(appRoot, "dist");
  if (!e2eBuild) {
    throw new Error("MYOWNNOTION_E2E_WEB_OUTDIR is restricted to E2E builds");
  }
  if (!path.isAbsolute(requested)) {
    throw new Error("MYOWNNOTION_E2E_WEB_OUTDIR must be an absolute temporary path");
  }
  const resolved = path.resolve(requested);
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (
    !resolved.startsWith(temporaryRoot) ||
    !path.basename(resolved).startsWith("myownnotion-e2e-web-")
  ) {
    throw new Error(
      "MYOWNNOTION_E2E_WEB_OUTDIR must be a dedicated myownnotion-e2e-web-* directory under the system temporary root",
    );
  }
  return resolved;
}

const outdir = outputDirectory();

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

const graphWorkerBuild = await requireSuccessfulBuild(
  "the knowledge graph worker",
  await Bun.build({
    entrypoints: [
      path.join(appRoot, "src", "features", "knowledge-graph", "knowledge-graph.worker.ts"),
    ],
    outdir,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "external",
    env: "disable",
    naming: {
      entry: "assets/knowledge-graph.worker-[hash].[ext]",
    },
  }),
);
const graphWorkerOutput = graphWorkerBuild.outputs.find(
  (output) => output.kind === "entry-point" && output.path.endsWith(".js"),
);
if (graphWorkerOutput === undefined) {
  throw new Error("The Bun build did not emit the knowledge graph worker entry");
}
const graphWorkerUrl = publicUrl(graphWorkerOutput.path);

/**
 * Moves base64 font faces out of the built stylesheets.
 *
 * KaTeX's stylesheet embeds sixty woff2/woff/ttf faces as `data:` URIs. Bun
 * inlines every one of them, which put 1.4 MB of base64 into the
 * render-blocking CSS. The files are content-addressed, served from the
 * immutable `/assets/` cache location, and fetched by the browser only when a
 * glyph actually uses them. The guard fails the build if a future bundler
 * starts inlining again, because that silently restores the regression.
 */
async function externalizeEmbeddedFonts(build: Bun.BuildOutput): Promise<number> {
  const fontDirectory = path.join(outdir, "assets", "fonts");
  const fonts = new Map<string, Uint8Array>();
  let replacedFaces = 0;

  for (const output of build.outputs) {
    if (!output.path.endsWith(".css")) continue;
    const css = await readFile(output.path, "utf8");
    const rewritten = css.replace(
      /url\(data:(font\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)\)/g,
      (_match, mime: string, base64: string) => {
        const bytes = Buffer.from(base64, "base64");
        const extension = mime.slice("font/".length);
        const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${extension}`;
        fonts.set(name, bytes);
        replacedFaces += 1;
        return `url(/assets/fonts/${name})`;
      },
    );
    if (rewritten !== css) await writeFile(output.path, rewritten);
  }

  if (fonts.size === 0) return 0;
  await mkdir(fontDirectory, { recursive: true });
  await Promise.all(
    [...fonts].map(([name, bytes]) => writeFile(path.join(fontDirectory, name), bytes)),
  );
  return replacedFaces;
}

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
      __MYOWNNOTION_GRAPH_WORKER_URL__: JSON.stringify(graphWorkerUrl),
    },
    naming: {
      entry: "[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
  }),
);

const externalizedFontFaces = await externalizeEmbeddedFonts(applicationBuild);
if (externalizedFontFaces === 0) {
  throw new Error(
    "The web build no longer externalizes its embedded fonts; the render-blocking CSS budget regressed.",
  );
}

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
  globPatterns: ["**/*.{js,css,html,png,svg,woff,woff2,ttf,wasm,webmanifest}"],
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});
if (injected.count === 0) {
  throw new Error("Workbox did not inject any application-shell asset");
}

await access(path.join(outdir, "index.html"));
await access(serviceWorkerPath);
const emittedFiles = [...new Bun.Glob("**/*").scanSync({ cwd: outdir, onlyFiles: true })];
requireWebAssetClasses(emittedFiles);

const javascript = await Promise.all(
  emittedFiles
    .filter((file) => file.endsWith(".js") && file !== "service-worker.js")
    .map((file) => readFile(path.join(outdir, file), "utf8")),
);
if (
  !javascript.some((source) => source.includes(workerUrl)) ||
  !javascript.some((source) => source.includes(graphWorkerUrl))
) {
  throw new Error("The web application does not reference every emitted worker");
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
