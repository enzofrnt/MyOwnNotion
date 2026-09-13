import { createMcpHandler } from "@modelcontextprotocol/server";
import type { FastifyInstance } from "fastify";
import { consumeRateLimit } from "../security/rate-limit-service.ts";
import { requestContext } from "../security/request-context.ts";
import { McpAccessError } from "./access-service.ts";
import { createMcpTools, type McpToolsDeps } from "./tools.ts";

export function registerMcpHttp(
  app: FastifyInstance,
  deps: Omit<McpToolsDeps, "principal" | "correlationId"> & { publicOrigin: string },
) {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    bodyLimit: 1_048_576,
    handler: async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (request.headers.origin !== undefined && request.headers.origin !== deps.publicOrigin)
        return reply.status(403).send({ code: "mcp.origin-refused" });
      const correlationId = requestContext(request).correlationId;
      try {
        const limit = await consumeRateLimit(deps.context.db, {
          installationId: deps.access.deps.installationId,
          operation: "mcp.request",
          subject: request.ip,
          now: deps.access.deps.now(),
        });
        if (!limit.allowed) return reply.status(429).send({ code: "mcp.rate-limited" });
        const bearer =
          /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
        const principal = await deps.access.authenticate(bearer, correlationId);
        const handler = createMcpHandler(
          () => createMcpTools({ ...deps, principal, correlationId }),
          {
            legacy: "stateless",
            responseMode: "auto",
            maxSubscriptions: 0,
            keepAliveMs: 0,
          },
        );
        const headers = new Headers();
        // Only transport metadata reaches the SDK; cookie and secret stay outside it.
        for (const name of [
          "content-type",
          "accept",
          "mcp-protocol-version",
          "mcp-method",
          "mcp-name",
        ])
          if (typeof request.headers[name] === "string") headers.set(name, request.headers[name]);
        try {
          const response = await handler.fetch(
            new Request(new URL("/mcp", deps.publicOrigin), {
              method: request.method,
              headers,
              ...(request.method === "POST" ? { body: JSON.stringify(request.body) } : {}),
            }),
            { parsedBody: request.body },
          );
          response.headers.forEach((value, name) => {
            reply.header(name, value);
          });
          return reply.status(response.status).send(Buffer.from(await response.arrayBuffer()));
        } finally {
          await handler.close();
        }
      } catch (error) {
        if (error instanceof McpAccessError) {
          if (error.status === 401)
            reply.header("www-authenticate", 'Bearer realm="MyOwnNotion MCP"');
          return reply.status(error.status).send({ code: error.code });
        }
        // Neither parser diagnostics nor runtime errors echo untrusted input.
        return reply.status(503).send({ code: "mcp.unavailable" });
      }
    },
  });
}
