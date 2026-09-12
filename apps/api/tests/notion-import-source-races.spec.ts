import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({
  mode: "",
  file: "",
  root: "",
  closes: 0,
  containmentCalls: 0,
  rootStats: 0,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    lstat: async (path: string) => {
      const info = await fs.lstat(path);
      if (path === faults.root && faults.mode === "ancestor-changed" && ++faults.rootStats === 3)
        return Object.assign(info, { ino: info.ino + 1 });
      if (path !== faults.file) return info;
      if (faults.mode === "outer-size-changed") return Object.assign(info, { size: info.size + 1 });
      if (faults.mode === "special-file") return Object.assign(info, { isFile: () => false });
      return info;
    },
    realpath: async (path: string) => {
      if (
        path === faults.file &&
        faults.mode === "containment-changed" &&
        ++faults.containmentCalls === 2
      )
        return "/outside-source/replaced-file";
      return fs.realpath(path);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (args[0] !== faults.file) return handle;
      let stats = 0;
      return new Proxy(handle, {
        get(target, property) {
          if (property === "close")
            return async () => {
              faults.closes++;
              await target.close();
            };
          if (property === "stat")
            return async () => {
              const info = await target.stat();
              stats++;
              if (faults.mode === "opened-directory")
                return Object.assign(info, { isFile: () => false });
              if (faults.mode === "opened-larger")
                return Object.assign(info, { size: info.size + 1 });
              if (faults.mode === "changed-mtime" && stats > 1)
                return Object.assign(info, { mtimeMs: info.mtimeMs + 1 });
              return info;
            };
          if (property === "createReadStream" && faults.mode === "stream-growth")
            return async function* () {
              yield Buffer.from("grew");
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import * as fs from "node:fs/promises";
import { readImportSource } from "../src/imports/notion/source.ts";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "notion-read-race-"));
  root = await fs.realpath(root);
  faults.file = join(root, "Page.md");
  faults.root = root;
  faults.mode = "";
  faults.closes = 0;
  faults.containmentCalls = 0;
  faults.rootStats = 0;
  await fs.writeFile(faults.file, "old");
});
afterEach(async () => {
  faults.mode = "";
  await fs.rm(root, { recursive: true, force: true });
});
describe("source filesystem races", () => {
  it.each([
    ["opened-directory", "import.unsafe-source", 1],
    ["opened-larger", "import.unsafe-source", 1],
    ["stream-growth", "import.source-too-large", 1],
    ["changed-mtime", "import.source-changed", 1],
    ["outer-size-changed", "import.source-changed", 1],
    ["containment-changed", "import.unsafe-path", 1],
    ["ancestor-changed", "import.source-changed", 1],
    ["special-file", "import.unsafe-source", 0],
  ])("refuses %s while closing every opened handle", async (mode, code, closes) => {
    faults.mode = String(mode);
    await expect(readImportSource(root)).rejects.toMatchObject({ code });
    expect(faults.closes).toBe(closes);
    expect(await fs.readFile(faults.file, "utf8")).toBe("old");
  });
});
