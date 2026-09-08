import { expect, it, vi } from "vitest";
import { runForgeCommand } from "../forge-command.ts";

function backend() {
  return {
    package: vi.fn(async (_options: unknown) => undefined),
    make: vi.fn(async (_options: unknown) => []),
    publish: vi.fn(async (_options: unknown) => undefined),
  };
}
const host = { platform: "win32", arch: "x64" };

it("packages the native host non-interactively through the core API", async () => {
  const api = backend();
  await runForgeCommand(["package"], api, "/desktop", host);
  expect(api.package).toHaveBeenCalledExactlyOnceWith({
    dir: "/desktop",
    interactive: false,
    platform: "win32",
    arch: "x64",
  });
});

it("forwards the maintained release arguments and Bun separator", async () => {
  const api = backend();
  await runForgeCommand(
    ["make", "--", "--platform", "linux", "--arch=arm64"],
    api,
    "/desktop",
    host,
  );
  expect(api.make).toHaveBeenCalledExactlyOnceWith({
    dir: "/desktop",
    interactive: false,
    platform: "linux",
    arch: "arm64",
  });
});

it("passes publication architecture to the nested make options", async () => {
  const api = backend();
  await runForgeCommand(["publish", "--platform=darwin", "--arch", "arm64"], api, "/desktop", host);
  expect(api.publish).toHaveBeenCalledExactlyOnceWith({
    dir: "/desktop",
    interactive: false,
    makeOptions: { dir: "/desktop", interactive: false, platform: "darwin", arch: "arm64" },
  });
});

it.each([
  [],
  ["init"],
  ["make", "--arch", "universal"],
  ["make", "--platform", "freebsd"],
  ["make", "--platform", "darwin", "--arch", "x64"],
  ["make", "--ignore-errors"],
  ["make", "--arch"],
  ["package", "unrequested-directory"],
])("refuses unsupported commands, arguments and targets before doing work: %j", async (...args) => {
  const api = backend();
  await expect(runForgeCommand(args, api, "/desktop", host)).rejects.toThrow();
  expect(api.package).not.toHaveBeenCalled();
  expect(api.make).not.toHaveBeenCalled();
  expect(api.publish).not.toHaveBeenCalled();
});

it("preserves a failed maker or signing error instead of returning success", async () => {
  const api = backend();
  const failure = new Error("signing unavailable");
  api.make.mockRejectedValueOnce(failure);
  await expect(runForgeCommand(["make"], api, "/desktop", host)).rejects.toBe(failure);
});
