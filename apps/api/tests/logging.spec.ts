/**
 * Structured safe logging with private-content redaction (T091, FR-022).
 */

import { Writable } from "node:stream";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerErrorHandling } from "../src/plugins/errors.ts";
import { createApplicationLogger, REDACT_PATHS, registerLogging } from "../src/plugins/logging.ts";

function captureDestination(): { destination: Writable; read: () => string } {
  const chunks: string[] = [];
  return {
    destination: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    }),
    read: () => chunks.join(""),
  };
}

async function emitLog(options: Parameters<typeof registerLogging>[0]): Promise<string> {
  const captured = captureDestination();
  const app = Fastify({
    logger: registerLogging({ ...options, destination: captured.destination }),
  });
  app.get("/health", async () => ({ ok: true }));
  await app.inject({ method: "GET", url: "/health" });
  await app.close();
  return captured.read();
}

describe("logging configuration (T091)", () => {
  it("emits parseable ANSI-free JSON with stable metadata on non-TTY output", async () => {
    const output = await emitLog({
      env: { MYOWNNOTION_LOG_COLOR: "auto", NODE_ENV: "production" },
      isTTY: false,
    });
    expect(output).not.toContain("\u001B[");
    const records = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((record) => record["service"] === "api")).toBe(true);
    expect(records.every((record) => record["environment"] === "production")).toBe(true);
    expect(records.some((record) => record["msg"] === "request completed")).toBe(true);
  });

  it.each([
    { color: "auto", isTTY: true, ansi: true },
    { color: "always", isTTY: false, ansi: true },
    { color: "never", isTTY: true, ansi: false },
  ] as const)("renders readable terminal output for $color (TTY=$isTTY)", async (sample) => {
    const output = await emitLog({
      env: { MYOWNNOTION_LOG_COLOR: sample.color },
      isTTY: sample.isTTY,
    });
    expect(output).toContain("INFO");
    expect(output).toContain("request completed");
    expect(output.includes("\u001B[")).toBe(sample.ansi);
    expect(() => JSON.parse(output.trim().split("\n")[0] ?? "")).toThrow();
  });

  it("rejects unknown color modes and levels", () => {
    expect(() =>
      registerLogging({ env: { MYOWNNOTION_LOG_COLOR: "sometimes" }, isTTY: false }),
    ).toThrow(/MYOWNNOTION_LOG_COLOR.*auto, always, never/);
    expect(() =>
      registerLogging({ env: { MYOWNNOTION_LOG_LEVEL: "verbose" }, isTTY: false }),
    ).toThrow(/MYOWNNOTION_LOG_LEVEL.*trace.*silent/);
  });

  it("applies the configured minimum level", () => {
    expect(registerLogging({ env: { MYOWNNOTION_LOG_LEVEL: "warn" }, isTTY: false }).level).toBe(
      "warn",
    );
  });

  it("gives non-Fastify application processes the same structured policy", () => {
    const captured = captureDestination();
    const logger = createApplicationLogger({
      env: { MYOWNNOTION_LOG_COLOR: "auto", NODE_ENV: "production" },
      isTTY: false,
      destination: captured.destination,
    });
    logger.info({ migrationCount: 2 }, "database migrations applied");

    const record = JSON.parse(captured.read().trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      service: "api",
      environment: "production",
      migrationCount: 2,
      msg: "database migrations applied",
    });
    expect(captured.read()).not.toContain("\u001B[");
  });

  it("redacts request bodies, auth headers, documents, and structured content", () => {
    for (const required of [
      "req.body",
      "req.headers.authorization",
      "req.headers.cookie",
      "body",
      "payload",
      "document",
      "name",
      "snapshot",
      "query",
      "title",
      "snippet",
      "definition",
      "values",
      "relationTargets",
      "properties",
      "options",
      "views",
      "taskRoles",
      "filter",
      "sorts",
      "group",
      "label",
      "metadata",
      "csrfToken",
      "cookie",
      "sessionId",
      "updateBytes",
      "encryptedUpdateBytes",
      "persistedVersionVector",
      "serverVersionVector",
      "ciphertext",
      "fileBytes",
      "key",
      "err.message",
      "err.stack",
    ]) {
      expect(REDACT_PATHS).toContain(required);
    }
  });

  it("request serialization drops every field except method, url, and id", async () => {
    const captured: string[] = [];
    const app = Fastify({
      logger: {
        ...registerLogging(),
        stream: {
          write(line: string) {
            captured.push(line);
          },
        },
      },
    });
    app.post("/echo", async () => ({ ok: true }));

    const secret = "UltraPrivateContent-31337";
    await app.inject({
      method: "POST",
      url: "/echo",
      headers: { authorization: `Bearer ${secret}`, cookie: `session=${secret}` },
      payload: { name: secret, document: { body: { text: secret } } },
    });
    await app.close();

    const joined = captured.join("\n");
    expect(joined.length).toBeGreaterThan(0);
    // Private content never reaches the log stream.
    expect(joined).not.toContain(secret);
    // Structural fields remain for diagnostics.
    expect(joined).toContain("/echo");
    expect(joined).toContain("statusCode");
  });

  it("error logs keep safe structure without leaking payloads", async () => {
    const captured: string[] = [];
    const app = Fastify({
      logger: {
        ...registerLogging(),
        stream: {
          write(line: string) {
            captured.push(line);
          },
        },
      },
    });
    registerErrorHandling(app);
    const secret = "SecretPayloadValue-4242";
    app.post("/boom", async () => {
      const databaseError = Object.assign(new Error(`constraint contained ${secret}`), {
        code: "23505",
      });
      throw new Error(`structured projection failed for ${secret}`, { cause: databaseError });
    });
    const response = await app.inject({
      method: "POST",
      url: "/boom",
      payload: { name: secret },
    });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(captured.join("\n")).not.toContain(secret);
    expect(response.body).not.toContain(secret);
    const errorRecord = captured
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record["msg"] === "unhandled error");
    expect(errorRecord).toMatchObject({
      unexpectedErrorTypes: ["Error"],
      unexpectedErrorCodes: ["23505"],
    });
  });

  it("recursively redacts structured labels, values, filters, and error details", () => {
    const captured = captureDestination();
    const logger = createApplicationLogger({
      env: { MYOWNNOTION_LOG_COLOR: "never", NODE_ENV: "production" },
      isTTY: false,
      destination: captured.destination,
    });
    const secret = "PrivateStructuredSentinel-90210";
    const databaseId = "018f2000-0000-7000-8000-000000000001";

    logger.error(
      {
        databaseId,
        indexedCount: 7,
        projection: {
          definition: {
            properties: [{ name: secret, config: { options: [{ label: secret }] } }],
            views: [{ name: secret, filter: { operand: { value: secret } } }],
          },
          values: { property: { kind: "text", value: secret } },
          relationTargets: { property: [databaseId] },
        },
        err: new Error(`failed while comparing ${secret}`),
      },
      "structured projection failed",
    );

    const output = captured.read();
    expect(output).not.toContain(secret);
    expect(output).toContain(databaseId);
    expect(output).toContain("indexedCount");
    expect(output).toContain("structured projection failed");
  });

  it("removes query strings even when a caller tries a private GET search", async () => {
    const captured: string[] = [];
    const app = Fastify({
      logger: {
        ...registerLogging(),
        stream: { write: (line: string) => captured.push(line) },
      },
    });
    const secret = "sentinel-private-search-in-url";
    registerErrorHandling(app);
    await app.inject({ method: "GET", url: `/v1/search?query=${secret}` });
    await app.close();

    expect(captured.join("\n")).not.toContain(secret);
    expect(captured.join("\n")).toContain("/v1/search");
  });
});
