/** Disposable PostgreSQL 18 fixture, also usable by the Windows ARM runner's x64 emulator. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "win32") throw new Error("This fixture requires a Windows runner");
const temporary = process.env["RUNNER_TEMP"];
const githubPath = process.env["GITHUB_PATH"];
if (!temporary || !githubPath) throw new Error("A disposable GitHub runner is required");
const root = path.join(temporary, "desktop-postgres");
await mkdir(root, { recursive: true });
const archive = path.join(root, "postgres.zip");
const response = await fetch(
  "https://get.enterprisedb.com/postgresql/postgresql-18.4-1-windows-x64-binaries.zip",
  { signal: AbortSignal.timeout(300_000) },
);
if (!response.ok || !response.body) throw new Error("PostgreSQL fixture download failed");
const file = await open(archive, "wx");
try {
  const reader = response.body.getReader();
  let size = 0;
  while (true) {
    const value = await reader.read();
    if (value.done) break;
    size += value.value.length;
    if (size > 400_000_000) throw new Error("PostgreSQL fixture exceeds archive limit");
    await file.writeFile(value.value);
  }
} finally {
  await file.close();
}
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
if (hash.digest("hex") !== "7effe34c0bf89027b3f171447d351cbc460f4566c8d0f643daec67f140787858")
  throw new Error("PostgreSQL fixture checksum mismatch");
// Windows ships bsdtar, which reads ZIPs without PowerShell expression interpolation.
// Git Bash also ships a GNU tar.exe. Select Windows' bsdtar explicitly so a
// drive-letter path is never interpreted as a remote archive host.
const systemRoot = process.env["SystemRoot"];
if (!systemRoot) throw new Error("The Windows system directory is unavailable");
execFileSync(
  path.join(systemRoot, "System32", "tar.exe"),
  ["-xf", archive, "-C", root, "pgsql/bin", "pgsql/lib", "pgsql/share"],
  {
    stdio: "inherit",
  },
);
const bin = path.join(root, "pgsql", "bin");
const data = path.join(root, "data");
execFileSync(
  path.join(bin, "initdb.exe"),
  ["-D", data, "-U", "postgres", "--auth=trust", "--encoding=UTF8", "--locale=C"],
  { stdio: "inherit" },
);
execFileSync(
  path.join(bin, "pg_ctl.exe"),
  ["-D", data, "-l", path.join(root, "postgres.log"), "-o", "-h 127.0.0.1 -p 5432", "-w", "start"],
  { stdio: "inherit" },
);
await appendFile(githubPath, `${bin}\n`);
console.info("Disposable PostgreSQL 18 fixture is ready on loopback.");
