import { createServer } from "node:http";

export async function listenHealthServer(
  handler: (url: URL) => {
    readonly status: number;
    readonly body: unknown;
    readonly protocol?: string;
  },
): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const result = handler(url);
    if (result.protocol !== undefined) {
      response.setHeader("x-myownnotion-protocol", result.protocol);
    }
    response.statusCode = result.status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
