import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LockedDependency {
  readonly specifier?: string;
  readonly version?: string;
}

interface BunLockWorkspace {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface BunLock {
  readonly workspaces?: Record<string, BunLockWorkspace>;
  readonly packages?: Record<string, readonly [string, ...unknown[]]>;
}

function readManifest(relativePath: string): PackageManifest {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8")) as PackageManifest;
}

function workspaceManifestPaths(): readonly string[] {
  const manifests = ["package.json"];
  for (const parent of ["apps", "packages"]) {
    const parentPath = path.join(repoRoot, parent);
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      const relativePath = path.join(parent, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(path.join(repoRoot, relativePath))) {
        manifests.push(relativePath);
      }
    }
  }
  return manifests;
}

function dependencyEntries(manifest: PackageManifest): ReadonlyArray<readonly [string, string]> {
  return [
    ...Object.entries(manifest.dependencies ?? {}),
    ...Object.entries(manifest.devDependencies ?? {}),
  ];
}

function lockedImporterDependency(
  importerName: string,
  dependencyGroup: "dependencies" | "devDependencies",
  dependencyName: string,
): LockedDependency | undefined {
  const lock = Bun.JSONC.parse(readFileSync(path.join(repoRoot, "bun.lock"), "utf8")) as BunLock;
  const specifier = lock.workspaces?.[importerName]?.[dependencyGroup]?.[dependencyName];
  const resolution = lock.packages?.[dependencyName]?.[0];
  const version = resolution?.match(/@([^@]+)$/)?.[1];
  if (specifier === undefined) return undefined;
  return version === undefined ? { specifier } : { specifier, version };
}

describe("the V1 editor toolchain", () => {
  const api = readManifest("apps/api/package.json");
  const web = readManifest("apps/web/package.json");
  const pageState = readManifest("packages/page-state/package.json");

  it("locks the Fastify WebSocket adapter without adding a collaboration service", () => {
    expect(api.dependencies?.["@fastify/websocket"]).toBe("^11.3.0");
    expect(lockedImporterDependency("apps/api", "dependencies", "@fastify/websocket")).toEqual({
      specifier: "^11.3.0",
      version: "11.3.0",
    });

    const forbidden = new Set([
      "@hocuspocus/provider",
      "@hocuspocus/server",
      "@y-sweet/client",
      "loro-websocket",
      "socket.io",
      "socket.io-client",
      "y-websocket",
    ]);
    for (const manifestPath of workspaceManifestPaths()) {
      for (const [name] of dependencyEntries(readManifest(manifestPath))) {
        expect(
          forbidden.has(name),
          `${manifestPath} depends on external sync runtime ${name}`,
        ).toBe(false);
      }
    }
  });

  it("locks the three BlockNote Community packages to one exact version", () => {
    const expected = {
      "@blocknote/ariakit": "0.54.0",
      "@blocknote/core": "0.54.0",
      "@blocknote/react": "0.54.0",
    } as const;

    for (const [name, version] of Object.entries(expected)) {
      expect(web.dependencies?.[name]).toBe(version);
      expect(lockedImporterDependency("apps/web", "dependencies", name)?.specifier).toBe(version);
    }
  });

  it("locks the operational and visual foundations to reviewed versions", () => {
    const expectedWebDependencies = {
      "@ariakit/react": "0.4.37",
      "@dnd-kit/core": "6.3.1",
      "@dnd-kit/sortable": "10.0.0",
      "@dnd-kit/utilities": "3.2.2",
      "lucide-react": "1.33.0",
    } as const;
    const expectedWebDevDependencies = {
      "@tailwindcss/vite": "4.3.3",
      tailwindcss: "4.3.3",
    } as const;

    for (const [name, version] of Object.entries(expectedWebDependencies)) {
      expect(web.dependencies?.[name]).toBe(version);
      expect(lockedImporterDependency("apps/web", "dependencies", name)?.specifier).toBe(version);
    }
    for (const [name, version] of Object.entries(expectedWebDevDependencies)) {
      expect(web.devDependencies?.[name]).toBe(version);
      expect(lockedImporterDependency("apps/web", "devDependencies", name)?.specifier).toBe(
        version,
      );
    }

    expect(pageState.dependencies?.["loro-crdt"]).toBe("1.14.1");
    expect(
      lockedImporterDependency("packages/page-state", "dependencies", "loro-crdt")?.specifier,
    ).toBe("1.14.1");
  });

  it("copies every workspace manifest before installing image dependencies", () => {
    const workspaceManifests = workspaceManifestPaths().filter(
      (manifestPath) => manifestPath !== "package.json",
    );

    for (const dockerfilePath of ["docker/api.Dockerfile", "docker/web.Dockerfile"]) {
      const dockerfile = readFileSync(path.join(repoRoot, dockerfilePath), "utf8");
      for (const manifestPath of workspaceManifests) {
        const packageDirectory = path.dirname(manifestPath);
        expect(dockerfile, `${dockerfilePath} does not install ${manifestPath}`).toContain(
          `COPY ${manifestPath} ${packageDirectory}/`,
        );
      }
    }
  });

  it("contains no BlockNote XL dependency", () => {
    for (const manifestPath of workspaceManifestPaths()) {
      const xlDependency = dependencyEntries(readManifest(manifestPath)).find(([name]) =>
        name.startsWith("@blocknote/xl-"),
      );
      expect(xlDependency, `${manifestPath} includes a commercial BlockNote XL package`).toBe(
        undefined,
      );
    }
  });

  it("keeps Loro's browser Wasm beside its loader during Vite development", () => {
    const viteConfig = readFileSync(path.join(repoRoot, "apps/web/vite.config.ts"), "utf8");

    expect(viteConfig).toContain('replacement: "loro-crdt/browser"');
    expect(viteConfig).toMatch(/optimizeDeps:\s*\{[\s\S]*?exclude:\s*\["loro-crdt"\]/);
    expect(viteConfig).toContain('process.env["MYOWNNOTION_VITE_CACHE_DIR"]');
  });

  it("keeps page-state independent from editor, UI, storage and server frameworks", () => {
    const forbidden = [
      "react",
      "react-dom",
      "dexie",
      "fastify",
      "drizzle-orm",
      "@blocknote/core",
      "@blocknote/react",
      "@blocknote/ariakit",
    ];
    const names = dependencyEntries(pageState).map(([name]) => name);

    for (const name of forbidden) {
      expect(names, `page-state must not depend on ${name}`).not.toContain(name);
    }
  });
});
