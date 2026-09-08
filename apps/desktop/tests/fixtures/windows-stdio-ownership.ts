/** Regression for Bun's Windows handle ownership: https://github.com/oven-sh/bun/pull/39966. */
import { spawn } from "node:child_process";
import { closeSync, fstatSync, openSync } from "node:fs";
import { Duplex } from "node:stream";

if (process.platform !== "win32") throw new Error("This fixture requires Windows handles");

async function exchangeThenOpenFiles(files: number[]) {
  const child = spawn(
    process.execPath,
    ["-e", "const fs = require('fs'); for (const fd of [3, 4, 5]) fs.writeSync(fd, 'fd' + fd);"],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  const exit = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Child exit ${code}`)),
    );
  });
  const messages = child.stdio.slice(3).map((stream) => {
    if (!(stream instanceof Duplex)) throw new Error("Missing additional pipe");
    return new Promise<string>((resolve, reject) => {
      let data = "";
      stream.on("data", (chunk) => {
        data += String(chunk);
      });
      stream.once("error", reject);
      stream.once("close", () => resolve(data));
    });
  });
  const [data] = await Promise.all([Promise.all(messages), exit]);
  if (data.join(",") !== "fd3,fd4,fd5") throw new Error("Additional pipe data was lost");
  // Reuse the released handle slots with read-only descriptors owned only by
  // this disposable subprocess. The old finalizer closes some of these files.
  for (let index = 0; index < 32; index++) files.push(openSync(process.execPath, "r"));
}

const files: number[] = [];
try {
  for (let round = 0; round < 3; round++) {
    await exchangeThenOpenFiles(files);
    Bun.gc(true);
    await Bun.sleep(0);
  }
  for (let collection = 0; collection < 4; collection++) {
    Bun.gc(true);
    await Bun.sleep(0);
  }
  let invalidated = 0;
  for (const descriptor of files) {
    try {
      fstatSync(descriptor);
    } catch {
      invalidated++;
    }
  }
  if (invalidated !== 0)
    throw new Error(`Child cleanup invalidated ${invalidated} independent files`);
  process.stdout.write(`${JSON.stringify({ pipes: 9, independentFiles: files.length })}\n`);
} finally {
  for (const descriptor of files) {
    try {
      closeSync(descriptor);
    } catch {
      /* Preserve the original ownership failure. */
    }
  }
}
