/**
 * Structured safe logging with private-content redaction (T091, FR-022).
 */

import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS, registerLogging } from "../src/plugins/logging.ts";

describe("logging configuration (T091)", () => {
  it("redacts request bodies, auth headers, names, documents, and snapshots", () => {
    for (const required of [
      "req.body",
      "req.headers.authorization",
      "req.headers.cookie",
      "body",
      "payload",
      "document",
      "name",
      "snapshot",
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
    app.post("/boom", async () => {
      throw new Error("internal detail");
    });
    const secret = "SecretPayloadValue-4242";
    const response = await app.inject({
      method: "POST",
      url: "/boom",
      payload: { name: secret },
    });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(captured.join("\n")).not.toContain(secret);
  });

  it("never logs nested editor JSON text", async () => {
    const captured: string[] = [];
    const app = Fastify({
      logger: {
        ...registerLogging(),
        stream: { write: (line: string) => captured.push(line) },
      },
    });
    app.put("/document", async () => ({ ok: true }));
    const secret = "PrivateEditorSpan-99231";
    await app.inject({
      method: "PUT",
      url: "/document",
      payload: {
        document: {
          formatVersion: 3,
          body: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: secret,
                    marks: [
                      {
                        type: "wikiLink",
                        attrs: {
                          targetItemId: "01900000-0000-7000-8000-000000000001",
                          occurrenceId: "01900000-0000-7000-8000-000000000002",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        query: "PrivateGraphQuery-711",
      },
    });
    await app.close();
    expect(captured.join("\n")).not.toContain(secret);
    expect(captured.join("\n")).not.toContain("PrivateGraphQuery-711");
  });
});
