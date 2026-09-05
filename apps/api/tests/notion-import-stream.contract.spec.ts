import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;
let origin: string;
let previousHeartbeat: string | undefined;
beforeAll(async () => {
  previousHeartbeat = process.env["MYOWNNOTION_SSE_HEARTBEAT_MS"];
  process.env["MYOWNNOTION_SSE_HEARTBEAT_MS"] = "25";
  harness = await createApiHarness();
  origin = await harness.built.app.listen({ port: 0, host: "127.0.0.1" });
}, 120_000);
afterAll(async () => {
  if (previousHeartbeat === undefined) delete process.env["MYOWNNOTION_SSE_HEARTBEAT_MS"];
  else process.env["MYOWNNOTION_SSE_HEARTBEAT_MS"] = previousHeartbeat;
  await harness?.close();
});
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: (text: string) => boolean,
) {
  let text = "";
  const read = async () => {
    while (!done(text)) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("stream ended before the expected position");
      text += new TextDecoder().decode(chunk.value);
    }
    return text;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("no expected event on the healthy stream")),
          1500,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
async function stream(lastEventId?: string) {
  const response = await fetch(`${origin}/v1/changes/stream`, {
    headers: {
      accept: "text/event-stream",
      ...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
    },
  });
  if (!response.body) throw new Error("stream body missing");
  const reader = response.body.getReader();
  const greeting = await readUntil(reader, (text) => text.includes("event: advanced"));
  const cursor = /data: {"cursor":"(\d+)"}/.exec(greeting)?.[1];
  if (cursor === undefined) throw new Error("canonical greeting missing");
  return { reader, cursor };
}
async function externalWrite() {
  const databaseModule = new URL("../../../packages/database/src/index.ts", import.meta.url).href;
  const mutationModule = new URL("../src/plugins/mutations.ts", import.meta.url).href;
  const script = `import { createDatabase } from ${JSON.stringify(databaseModule)};
    import { submitCanonicalMutation } from ${JSON.stringify(mutationModule)};
    const database=createDatabase(process.env.IMPORT_TEST_DATABASE);
    try {
      const result=await submitCanonicalMutation({ db:database.db,
        workspaceId:process.env.IMPORT_TEST_WORKSPACE, schemaVersion:1,
        mutationId:crypto.randomUUID(), command:{type:"item.create", id:crypto.randomUUID(),
        kind:"folder",name:"Separate process import",placement:{kind:"hierarchy",parentItemId:null,positionKey:"a"}} });
      if(result.result.status!=="accepted") process.exitCode=1;
    } finally { await database.close(); }`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--eval", script], {
      env: {
        ...process.env,
        IMPORT_TEST_DATABASE: harness.postgres.connectionString,
        IMPORT_TEST_WORKSPACE: harness.built.context.workspaceId,
      },
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("separate writer failed")),
    );
  });
}
describe("canonical notification across the CLI/API process boundary", () => {
  it("wakes a healthy open stream after a separate Bun process commits", async () => {
    const opened = await stream();
    try {
      await externalWrite();
      const event = await readUntil(opened.reader, (text) => text.includes("event: advanced"));
      const cursor = /data: {"cursor":"(\d+)"}/.exec(event)?.[1];
      expect(Number(cursor)).toBeGreaterThan(Number(opened.cursor));
      expect(event).not.toContain("Separate process import");
    } finally {
      await opened.reader.cancel();
    }
  });
  it("catches up after reconnection and emits no advanced event while the cursor is unchanged", async () => {
    const offline = await stream();
    await offline.reader.cancel();
    await externalWrite();
    const online = await stream(offline.cursor);
    try {
      expect(Number(online.cursor)).toBeGreaterThan(Number(offline.cursor));
      const response = await harness.built.app.inject({
        method: "GET",
        url: `/v1/changes?after=${offline.cursor}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().changes.length).toBeGreaterThan(0);
      const idle = await readUntil(
        online.reader,
        (text) => (text.match(/keep-alive/g) ?? []).length >= 3,
      );
      expect(idle).not.toContain("event: advanced");
    } finally {
      await online.reader.cancel();
    }
  });
});
