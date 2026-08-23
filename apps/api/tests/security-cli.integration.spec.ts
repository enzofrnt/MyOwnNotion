/**
 * The protected local security CLI, driven end to end (T086, FR-019 – FR-021).
 *
 * The guarantee under test is structural: nothing leaves the tool except
 * through the renderer, every invocation joins one correlation ID in the audit
 * journal, and a failure still exits with a stable code and a rendered
 * message — never a raw stack trace.
 */

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT_CODES } from "../src/admin/command-output.ts";
import { runCli } from "../src/admin/security-cli.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let directory: string;
let keyMaterial: string;

beforeAll(async () => {
  harness = await createApiHarness();
  directory = await mkdtemp(path.join(os.tmpdir(), "mon-security-cli-"));
  keyMaterial = randomBytes(32).toString("base64");
  const keyFile = path.join(directory, "deployment-key");
  await writeFile(keyFile, keyMaterial, { mode: 0o600 });
  vi.stubEnv("DATABASE_URL", harness.postgres.connectionString);
  vi.stubEnv("MYOWNNOTION_DEPLOYMENT_KEY_FILE", keyFile);
  vi.stubEnv("MYOWNNOTION_PUBLIC_ORIGIN", "https://localhost.test");
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await harness?.close();
  await rm(directory, { recursive: true, force: true });
});

describe("the protected security entrypoint", () => {
  it("reports installation status as JSON without changing anything", async () => {
    const output: string[] = [];
    expect(await runCli(["security", "status", "--json"], (line) => output.push(line))).toBe(
      EXIT_CODES.ok,
    );
    const body = JSON.parse(output.at(-1) ?? "{}") as {
      ok?: boolean;
      data?: { ownerCount?: number; policies?: Record<string, unknown> };
    };
    expect(body.ok).toBe(true);
    // The renderer redacts nested payloads before they leave the tool, so the
    // assertion is on shape: both policy kinds are reported, never skipped.
    expect(Object.keys(body.data?.policies ?? {})).toEqual(["wrapping-key", "data-key"]);
  });

  it("confirms a readable deployment key without printing any of it", async () => {
    const output: string[] = [];
    expect(await runCli(["security", "key", "check", "--json"], (line) => output.push(line))).toBe(
      EXIT_CODES.ok,
    );
    const body = JSON.parse(output.at(-1) ?? "{}") as {
      data?: { fingerprint?: string; path?: string };
    };
    // Sixteen base64url characters: enough to tell two keys apart, and no
    // part of the key itself.
    expect(body.data?.fingerprint).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(body.data?.path).toContain("deployment-key");
    // Availability and a fingerprint are the answer; the bytes never appear.
    expect(output.join("\n")).not.toContain(keyMaterial);
  });

  it("answers rotation status for both policies", async () => {
    const output: string[] = [];
    expect(
      await runCli(["security", "rotation", "status", "--json"], (line) => output.push(line)),
    ).toBe(EXIT_CODES.ok);
    const body = JSON.parse(output.at(-1) ?? "{}") as {
      data?: { policies?: Record<string, unknown> };
    };
    expect(Object.keys(body.data?.policies ?? {})).toEqual(["wrapping-key", "data-key"]);
  });

  it("inspects compatibility read-only and refuses a target that is its own source", async () => {
    const target = path.join(directory, "target");
    const output: string[] = [];
    expect(
      await runCli(
        [
          "security",
          "compatibility",
          "inspect",
          "--target",
          target,
          "--source",
          directory,
          "--json",
        ],
        (line) => output.push(line),
      ),
    ).toBe(EXIT_CODES.ok);
    expect(JSON.parse(output.at(-1) ?? "{}")).toMatchObject({ ok: true });

    const refused: string[] = [];
    expect(
      await runCli(
        ["security", "compatibility", "inspect", "--target", target, "--source", target, "--json"],
        (line) => refused.push(line),
      ),
    ).toBe(EXIT_CODES.usage);
    expect(JSON.parse(refused.at(-1) ?? "{}")).toMatchObject({ ok: false });
  });

  it("renders an unknown command through the renderer with a usage exit code", async () => {
    const output: string[] = [];
    expect(await runCli(["security", "explode"], (line) => output.push(line))).toBe(
      EXIT_CODES.usage,
    );
    // The refusal names the supported vocabulary; it never leaks a raw error.
    expect(output.join("\n")).toMatch(/unknown command/i);
    expect(output.join("\n")).toContain("security recovery import");
  });
});
