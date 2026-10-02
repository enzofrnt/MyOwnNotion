import { execFileSync } from "node:child_process";
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
