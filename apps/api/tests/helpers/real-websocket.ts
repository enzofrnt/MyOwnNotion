import type { ClientRequest, IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";

const listeners = new WeakMap<FastifyInstance, Promise<number>>();

async function listenerPort(app: FastifyInstance): Promise<number> {
  const address = app.server.address();
  if (address !== null && typeof address !== "string") return address.port;

  let listening = listeners.get(app);
  if (listening === undefined) {
    listening = app
      .listen({ host: "127.0.0.1", port: 0 })
      .then(() => (app.server.address() as AddressInfo).port);
    listeners.set(app, listening);
  }
  return await listening;
}

/**
 * Connect through a real loopback listener instead of Fastify's Node-specific
 * `injectWS()` simulation. This exercises the exact upgrade path production
 * uses and works under Bun without weakening any Origin or cookie checks.
 */
export async function connectRealWebSocket(
  app: FastifyInstance,
  pathname: string,
  headers: Record<string, string | undefined>,
): Promise<WebSocket> {
  const port = await listenerPort(app);
  return await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, [], {
      headers: Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
    });

    const cleanup = () => {
      socket.off("open", opened);
      socket.off("error", failed);
      socket.off("unexpected-response", refused);
    };
    const failed = (error: Error) => {
      cleanup();
      socket.terminate();
      reject(error);
    };
    const refused = (_request: ClientRequest, response: IncomingMessage) => {
      cleanup();
      // `ws.terminate()` emits one final error while CONNECTING. The HTTP
      // refusal is the expected outcome here, so consume only that teardown
      // signal instead of leaking it as an unhandled Vitest exception.
      socket.once("error", () => undefined);
      socket.terminate();
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.once("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        reject(
          new Error(
            `WebSocket upgrade refused with HTTP ${response.statusCode}${body === "" ? "" : `: ${body}`}`,
          ),
        );
      });
      response.resume();
    };
    const opened = () => {
      cleanup();
      resolve(socket);
    };
    socket.once("open", opened);
    socket.once("error", failed);
    socket.once("unexpected-response", refused);
  });
}
