import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { connectMcp } from "../src/mcp/exchange-cli.ts";

const fileFault = vi.hoisted(() => ({ kind: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (fileFault.kind !== "") {
        const original = file.stat.bind(file);
        vi.spyOn(file, "stat").mockImplementation(async () => {
          const stats = await original();
          if (fileFault.kind === "mode") stats.mode |= 0o004;
          if (fileFault.kind === "owner") stats.uid += 1;
          if (fileFault.kind === "directory") stats.isFile = () => false;
          return stats;
        });
      }
      return file;
    },
  };
});

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
const roots: string[] = [];
afterEach(async () => {
  if (originalPlatform !== undefined) Object.defineProperty(process, "platform", originalPlatform);
  fileFault.kind = "";
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "mon-mcp-private-config-"));
  roots.push(root);
  const codeFile = path.join(root, "code");
  const output = path.join(root, "config.json");
  const code = `mn_exchange_${randomBytes(32).toString("base64url")}`;
  const token = `mn_mcp_${randomBytes(32).toString("base64url")}`;
  await writeFile(codeFile, code, { mode: 0o600 });
  const exchange = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ accessToken: token, tokenType: "Bearer" }));
  return { input: { server: "https://notes.example.test", codeFile, output }, exchange, token };
}

it.each(["win32", "freebsd"])(
  "refuses %s before consuming a code or creating an output",
  async (platform) => {
    const { input, exchange } = await fixture();
    Object.defineProperty(process, "platform", { value: platform });
    await expect(connectMcp(input)).rejects.toThrow("Linux or macOS");
    expect(exchange).not.toHaveBeenCalled();
    await expect(stat(input.output)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["mode", "owner", "directory"])(
  "refuses unverified %s before receiving any credential",
  async (kind) => {
    const { input, exchange } = await fixture();
    fileFault.kind = kind;
    await expect(connectMcp(input)).rejects.toThrow("private regular file");
    expect(exchange).not.toHaveBeenCalled();
    await expect(stat(input.output)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["linux", "darwin"])("creates a verified private configuration on %s", async (platform) => {
  const { input, exchange, token } = await fixture();
  Object.defineProperty(process, "platform", { value: platform });
  await connectMcp(input);
  expect(exchange).toHaveBeenCalledOnce();
  expect((await stat(input.output)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(input.output, "utf8"))).toEqual({
    mcpServers: {
      myownnotion: {
        url: "https://notes.example.test/mcp",
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  });
});
