import { Writable } from "node:stream";
import { schema } from "@myownnotion/database";
import { describe, expect, it } from "vitest";
import { createApplicationLogger } from "../src/plugins/logging.ts";

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

describe("search confidentiality", () => {
  it("redacts query, title and snippet fields from operational diagnostics", () => {
    const query = "sentinel-private-query-8701";
    const title = "sentinel-private-title-8702";
    const snippet = "sentinel-private-snippet-8703";
    const captured = captureDestination();
    const logger = createApplicationLogger({
      env: { NODE_ENV: "test", MYOWNNOTION_LOG_COLOR: "never" },
      destination: captured.destination,
      isTTY: false,
    });

    logger.info({ query, title, snippet, results: [{ title, snippet }] }, "search diagnostic");

    const output = captured.read();
    expect(output).not.toContain(query);
    expect(output).not.toContain(title);
    expect(output).not.toContain(snippet);
    expect(output).toContain("[redacted]");
  });

  it("has no PostgreSQL-backed search index or query-history relation", () => {
    const relationNames = Object.keys(schema).filter((name) => /search|query/i.test(name));
    expect(relationNames).toEqual([]);
  });
});
