/**
 * Multi-architecture image build gate (feature 002, FR-032/FR-034).
 *
 * The build is part of the quality gate, not of publication: it runs on every
 * candidate, including pull requests, and never pushes. Blocking rules:
 *
 *   - a base image without a pinned manifest-list digest blocks;
 *   - a build failure on either linux/amd64 or linux/arm64 blocks;
 *   - a missing Docker/buildx toolchain blocks (an unavailable check is never
 *     a pass).
 *
 * Output artifact: `image-build.json` with the platforms and resulting digests.
 *
 * Usage:
 *   bun run images:build              build both images for both platforms
 *   bun run images:build --resolve    resolve and write base-image digests, then exit
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const baseImagesPath = path.join(repoRoot, "docker", "base-images.json");
const artifactPath = path.join(repoRoot, "image-build.json");

function buildIdentity(): string {
  const candidateSha = process.env["GITHUB_SHA"]?.trim();
  if (candidateSha !== undefined && candidateSha !== "") {
    return `sha-${candidateSha}`;
  }
  try {
    return `sha-${execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()}`;
  } catch {
    return "development";
  }
}

interface BaseImage {
  ref: string;
  digest: string;
  usedBy: string[];
}

interface BaseImagesFile {
  platforms: string[];
  bases: Record<string, BaseImage>;
}

interface Target {
  name: string;
  dockerfile: string;
  /** Build arguments naming the digest-pinned bases this target consumes. */
  baseArgs: Record<string, string>;
  /** Non-secret metadata embedded in the image. */
  buildArgs?: Record<string, string>;
}

const targets: Target[] = [
  {
    name: "api",
    dockerfile: "docker/api.Dockerfile",
    baseArgs: { BUN_BASE: "bun" },
    buildArgs: {
      APPLICATION_VERSION: buildIdentity(),
    },
  },
  {
    name: "web",
    dockerfile: "docker/web.Dockerfile",
    baseArgs: { BUN_BASE: "bun", NGINX_BASE: "nginx" },
  },
];

const resolveMode = process.argv.includes("--resolve");
const baseImages = JSON.parse(readFileSync(baseImagesPath, "utf8")) as BaseImagesFile;

function run(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: resolveMode ? ["ignore", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function requireBuildx(): void {
  try {
    run("docker", ["buildx", "version"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Image build gate cannot run: docker buildx is unavailable (${message}).\n` +
        "An unavailable gate is a blocking failure, not a pass.",
    );
    process.exit(1);
  }
}

if (resolveMode) {
  requireBuildx();
  for (const [name, base] of Object.entries(baseImages.bases)) {
    // The manifest-list digest, so both linux/amd64 and linux/arm64 resolve
    // from one pin.
    const digest = run("docker", [
      "buildx",
      "imagetools",
      "inspect",
      base.ref,
      "--format",
      "{{.Manifest.Digest}}",
    ]).trim();
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      console.error(`Could not resolve a manifest digest for ${base.ref} (got: ${digest})`);
      process.exit(1);
    }
    base.digest = digest;
    console.info(`resolved ${name}: ${base.ref}@${base.digest}`);
  }
  writeFileSync(baseImagesPath, `${JSON.stringify(baseImages, null, 2)}\n`, "utf8");
  console.info(`Wrote ${path.relative(repoRoot, baseImagesPath)}. Commit the pinned digests.`);
  process.exit(0);
}

// Blocking rule: no unpinned base may reach a build.
const unpinned = Object.entries(baseImages.bases).filter(
  ([, base]) => !/^sha256:[0-9a-f]{64}$/.test(base.digest),
);
if (unpinned.length > 0) {
  console.error("Image build gate failed: unpinned base image(s).\n");
  for (const [name, base] of unpinned) {
    console.error(`  - ${name} (${base.ref}) has no sha256 manifest-list digest`);
  }
  console.error(
    "\nRun `bun run images:build --resolve` on a machine with a Docker daemon and commit " +
      "docker/base-images.json.",
  );
  process.exit(1);
}

requireBuildx();

const platforms = baseImages.platforms.join(",");
const results: Array<{ target: string; dockerfile: string; platforms: string[]; digest: string }> =
  [];

function buildArguments(target: Target): string[] {
  const args: string[] = [];
  for (const [argument, baseName] of Object.entries(target.baseArgs)) {
    const base = baseImages.bases[baseName];
    if (base === undefined) {
      throw new Error(
        `${target.dockerfile} needs base \`${baseName}\`, which docker/base-images.json does not declare`,
      );
    }
    args.push("--build-arg", `${argument}=${base.ref}@${base.digest}`);
  }
  for (const [argument, value] of Object.entries(target.buildArgs ?? {})) {
    args.push("--build-arg", `${argument}=${value}`);
  }
  return args;
}

for (const target of targets) {
  const metadataFile = path.join(repoRoot, `.image-build-${target.name}.json`);
  const args = [
    "buildx",
    "build",
    "--platform",
    platforms,
    "--file",
    target.dockerfile,
    "--metadata-file",
    metadataFile,
    "--provenance=true",
    "--sbom=true",
  ];
  args.push(...buildArguments(target));
  // No `--push` and no `--load`: the gate builds and discards.
  args.push(".");

  console.info(`Building ${target.name} for ${platforms} …`);
  try {
    run("docker", args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Image build gate failed for ${target.name}: ${message}`);
    process.exit(1);
  }

  let digest = "";
  try {
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8")) as Record<string, string>;
    digest = metadata["containerimage.digest"] ?? "";
  } catch {
    digest = "";
  }
  results.push({
    target: target.name,
    dockerfile: target.dockerfile,
    platforms: baseImages.platforms,
    digest,
  });
}

const nativePlatform =
  process.arch === "arm64" ? "linux/arm64" : process.arch === "x64" ? "linux/amd64" : undefined;
if (nativePlatform === undefined) {
  console.error(`Image runtime smoke does not support host architecture ${process.arch}.`);
  process.exit(1);
}

const apiTarget = targets.find((target) => target.name === "api");
if (apiTarget === undefined) {
  console.error("Image runtime smoke cannot find the API image target.");
  process.exit(1);
}

// A multi-platform build proves that every manifest can be assembled, but it
// cannot be loaded into the local daemon and executed. Build the native API a
// second time from the warm BuildKit cache, then exercise the exact packaged
// entrypoints. This caught a Loro CommonJS/Wasm bundle that built cleanly for
// both architectures while every fresh deployment failed before migrations.
const smokeImage = `myownnotion-api:runtime-smoke-${process.pid}`;
try {
  run("docker", [
    "buildx",
    "build",
    "--platform",
    nativePlatform,
    "--file",
    apiTarget.dockerfile,
    "--load",
    "--tag",
    smokeImage,
    "--provenance=false",
    ...buildArguments(apiTarget),
    ".",
  ]);
  const smokeOutput = run(path.join(repoRoot, "scripts", "ci", "smoke-api-image.sh"), [
    smokeImage,
  ]).trim();
  console.info(smokeOutput);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Image runtime smoke failed: ${message}`);
  process.exitCode = 1;
} finally {
  try {
    run("docker", ["image", "rm", smokeImage]);
  } catch {
    console.warn(`Could not remove disposable image tag ${smokeImage}.`);
  }
}

if (process.exitCode === 1) {
  process.exit(1);
}

writeFileSync(
  artifactPath,
  `${JSON.stringify(
    {
      status: "pass",
      pushed: false,
      candidateSha: process.env["GITHUB_SHA"] ?? "",
      bases: Object.fromEntries(
        Object.entries(baseImages.bases).map(([name, base]) => [
          name,
          `${base.ref}@${base.digest}`,
        ]),
      ),
      images: results,
      runtimeSmoke: {
        status: "pass",
        platform: nativePlatform,
        image: "api",
        probes: ["bun-runtime", "migration-entrypoint", "server-entrypoint"],
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.info(`Image build gate passed (${results.length} images, platforms: ${platforms}).`);
