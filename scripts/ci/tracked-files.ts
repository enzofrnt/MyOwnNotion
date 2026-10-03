import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

/** Read the tracked blob itself; a symlink stores its path, not its target's bytes. */
export function readTrackedTextFile(
  repoRoot: string,
  file: string,
  maxBytes: number,
): string | undefined {
  const absolute = path.join(repoRoot, file);
  const metadata = lstatSync(absolute);
  if (metadata.size > maxBytes) return undefined;
  return metadata.isSymbolicLink() ? readlinkSync(absolute) : readFileSync(absolute, "utf8");
}

export function trackedFiles(
  repoRoot: string,
  options: { readonly pathspec?: readonly string[]; readonly maxBuffer?: number } = {},
): string[] {
  const output = execFileSync("git", ["ls-files", "-z", ...(options.pathspec ?? [])], {
    cwd: repoRoot,
    encoding: "utf8",
    ...(options.maxBuffer === undefined ? {} : { maxBuffer: options.maxBuffer }),
  });
  return output.split("\0").filter((entry) => entry.length > 0);
}
