import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { connectRealWebSocket } from "./real-websocket.ts";

const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];

async function socketApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  await app.register(websocket);
  return app;
}

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets.length = 0;
  await Promise.all(apps.splice(0).map(async (app) => await app.close()));
});

describe("real Bun WebSocket test boundary", () => {
  it("opens a loopback listener and exchanges a frame", async () => {
    const app = await socketApp();
    app.get("/socket", { websocket: true }, (socket) => {
      socket.once("message", (frame) => socket.send(frame));
    });

    const socket = await connectRealWebSocket(app, "/socket", {});
    sockets.push(socket);
    const reply = new Promise<string>((resolve) => {
      socket.once("message", (frame) => resolve(frame.toString()));
    });
    socket.send("native-bun-ws");

    await expect(reply).resolves.toBe("native-bun-ws");
  });

  it("reports the HTTP refusal body without leaking a teardown error", async () => {
    const app = await socketApp();
    app.get(
      "/refused",
      {
        websocket: true,
        preValidation: (_request, reply) => {
          reply.status(401).send({ code: "authentication_required" });
        },
      },
      () => undefined,
    );

    await expect(connectRealWebSocket(app, "/refused", {})).rejects.toThrow(
      /HTTP 401.*authentication_required/,
    );
  });
});
