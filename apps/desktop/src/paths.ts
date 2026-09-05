import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function repositoryRootFromHost(): string {
  const override = process.env["MYOWNNOTION_REPO_ROOT"];
  if (
    override !== undefined &&
    override.length > 0 &&
    existsSync(path.join(override, "package.json"))
  ) {
    return override;
  }
  const candidates = [
    path.resolve(here, "..", "..", ".."),
    path.resolve(here, "..", "..", "..", ".."),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, "apps", "desktop", "package.json")) &&
      existsSync(path.join(candidate, "apps", "web"))
    ) {
      return candidate;
    }
  }
  return candidates[0] ?? path.resolve(here, "..");
}

export function packagedWebDist(): string {
  const override = process.env["MYOWNNOTION_WEB_DIST"];
  if (override !== undefined && override.length > 0 && existsSync(override)) {
    return override;
  }
  if (
    typeof process.resourcesPath === "string" &&
    existsSync(path.join(process.resourcesPath, "dist"))
  ) {
    return path.join(process.resourcesPath, "dist");
  }
  return path.join(repositoryRootFromHost(), "apps", "web", "dist");
}

export function profilesFile(userData: string): string {
  return path.join(userData, "server-profiles.json");
}

export function windowStateFile(userData: string): string {
  return path.join(userData, "window-state.json");
}
