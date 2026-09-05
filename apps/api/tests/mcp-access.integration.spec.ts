import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLIENT_CAPABILITIES_META_KEY,
  Client,
  PROTOCOL_VERSION_META_KEY,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { McpGrantResult, McpScope } from "@myownnotion/contracts";
import { schema } from "@myownnotion/database";
import { generateUuidV7 } from "@myownnotion/domain";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectMcp, runMcpConnect } from "../src/mcp/exchange-cli.ts";
import { createItemViaApi } from "./helpers/app.ts";
import {
  type AuthenticatedPageOperationHarness,
  createAuthenticatedPageOperationHarness,
} from "./helpers/authenticated-page-operations.ts";

let harness: AuthenticatedPageOperationHarness;
let headers: Record<string, string>;
let origin: string;
let branchId: string;
let secretId: string;
let now = new Date();
const clients: Client[] = [];
const allScope: McpScope = {
  actions: ["read", "search", "create", "edit", "delete"],
  allContent: true,
  branchRootIds: [],
  files: true,
};
beforeAll(async () => {
  harness = await createAuthenticatedPageOperationHarness({ now: () => now });
  origin = await harness.api.built.app.listen({ host: "127.0.0.1", port: 0 });
}, 180_000);
afterAll(async () => {
  await Promise.all(clients.map((client) => client.close()));
  await harness?.close();
});
beforeEach(async () => {
  now = new Date();
  await harness.reset();
  headers = await harness.authenticate();
  branchId = (
    await createItemViaApi(harness.api, { kind: "folder", name: "Allowed branch", headers })
  ).itemId;
  secretId = (
    await createItemViaApi(harness.api, { kind: "page", name: "Private sibling title", headers })
  ).itemId;
});
async function grant(scope = allScope, extra = {}): Promise<McpGrantResult> {
  const response = await harness.api.built.app.inject({
    method: "POST",
    url: "/v1/mcp/connections",
    headers,
    payload: { label: "Private assistant label", scope, ...extra },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json();
}
async function exchange(code: string) {
  return harness.api.built.app.inject({ method: "POST", url: "/mcp/exchange", payload: { code } });
}
async function connect(scope = allScope) {
  const granted = await grant(scope);
  const exchanged = await exchange(granted.exchangeCode);
  expect(exchanged.statusCode, exchanged.body).toBe(200);
  const accessToken = exchanged.json().accessToken as string;
  const client = new Client({ name: "mcp-integration-test", version: "1.0.0" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", origin), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    }),
  );
  return { client, granted, accessToken };
}
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, value: JSON.parse(content[0]?.text ?? "null") };
}

describe("scoped MCP through the real official HTTP client", () => {
  it("exchanges once under concurrent requests, protects labels/secrets and enforces expiry/revocation", async () => {
    const created = await grant();
    const results = await Promise.all([
      exchange(created.exchangeCode),
      exchange(created.exchangeCode),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    const token = results.find((r) => r.statusCode === 200)?.json().accessToken as string;
    const stored = await harness.api.built.database.db.select().from(schema.mcpConnections);
    expect(JSON.stringify(stored)).not.toContain("Private assistant label");
    expect(JSON.stringify(stored)).not.toContain(token);
    const inventory = await harness.api.built.app.inject({
      method: "GET",
      url: "/v1/mcp/connections",
      headers,
    });
    expect(inventory.json().connections[0]).toMatchObject({
      label: "Private assistant label",
      status: "active",
    });
    expect(inventory.body).not.toContain(token);
    const pending = await grant();
    now = new Date(now.getTime() + 600_000);
    expect((await exchange(pending.exchangeCode)).statusCode).toBe(401);
    now = new Date(now.getTime() + 90 * 86_400_000);
    expect(
      (
        await fetch(`${origin}/mcp`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(401);
  });
  it("requires recent authenticated owner approval and keeps bearer tokens out of owner APIs", async () => {
    const anonymous = await harness.api.built.app.inject({
      method: "POST",
      url: "/v1/mcp/connections",
      payload: { label: "x", scope: allScope },
    });
    expect(anonymous.statusCode).toBe(401);
    const { accessToken, granted, client } = await connect();
    expect(
      (
        await harness.api.built.app.inject({
          method: "GET",
          url: "/v1/items",
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).statusCode,
    ).toBe(401);
    const noCsrf = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/mcp/connections/${granted.connection.id}/revoke`,
      headers: { cookie: headers["cookie"] ?? "" },
    });
    expect(noCsrf.statusCode).toBe(403);
    const revoked = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/mcp/connections/${granted.connection.id}/revoke`,
      headers,
    });
    expect(revoked.statusCode).toBe(204);
    await expect(client.listTools()).rejects.toThrow();
    now = new Date(now.getTime() + 16 * 60_000);
    const stale = await harness.api.built.app.inject({
      method: "POST",
      url: "/v1/mcp/connections",
      headers,
      payload: { label: "stale", scope: allScope },
    });
    expect(stale.statusCode).toBe(428);
    expect(stale.json().code).toBe("recent_authentication_required");
  });
  it("discovers real tools and creates/reads/renames/trashes encrypted canonical content with safe replay", async () => {
    const { client } = await connect();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "search",
        "read_item",
        "list_items",
        "create_item",
        "rename_item",
        "edit_page",
        "trash_item",
        "read_file",
      ]),
    );
    const itemId = generateUuidV7();
    const create = {
      mutationId: generateUuidV7(),
      id: itemId,
      kind: "page",
      name: "MCP secret title",
      parentId: branchId,
      text: "Encrypted MCP paragraph",
    };
    const created = await call(client, "create_item", create);
    expect(created).toMatchObject({ isError: false, value: { itemId } });
    expect(await call(client, "create_item", create)).toEqual(created);
    const read = await call(client, "read_item", { itemId });
    expect(read.isError).toBe(false);
    expect(read.value.name).toBe("MCP secret title");
    expect(JSON.stringify(read.value.pageDocument)).toContain("Encrypted MCP paragraph");
    const stored = await harness.api.built.database.db.execute(
      sql`SELECT i.name, p.body FROM items i JOIN page_documents p ON p.page_id=i.id WHERE i.id=${itemId}::uuid`,
    );
    expect(JSON.stringify(stored.rows)).not.toContain("MCP secret title");
    expect(JSON.stringify(stored.rows)).not.toContain("Encrypted MCP paragraph");
    const renamed = await call(client, "rename_item", {
      mutationId: generateUuidV7(),
      itemId,
      name: "Renamed safely",
    });
    expect(renamed.isError).toBe(false);
    const appRead = await harness.api.built.app.inject({
      method: "GET",
      url: `/v1/items/${itemId}`,
      headers,
    });
    expect(appRead.json().name).toBe("Renamed safely");
    expect(JSON.stringify(appRead.json().pageDocument)).toContain("Encrypted MCP paragraph");
    const other = await connect();
    expect((await call(other.client, "create_item", create)).isError).toBe(true);
    expect(
      (await call(client, "trash_item", { mutationId: generateUuidV7(), itemId })).isError,
    ).toBe(false);
    expect(
      (
        await harness.api.built.app.inject({ method: "GET", url: `/v1/items/${itemId}`, headers })
      ).json().lifecycle,
    ).toBe("trashed");
    const audit = await harness.api.built.database.db
      .select()
      .from(schema.securityAuditEvents)
      .where(eq(schema.securityAuditEvents.actorClass, "mcp"));
    expect(audit.some((row) => row.objectKind === "create_item" && row.outcome === "success")).toBe(
      true,
    );
    expect(JSON.stringify(audit)).not.toContain("MCP secret title");
    const auditResponse = await harness.api.built.app.inject({
      method: "GET",
      url: "/v1/mcp/audit",
      headers,
    });
    expect(auditResponse.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "mcp.granted", outcome: "success" }),
        expect.objectContaining({ action: "create_item", outcome: "success" }),
      ]),
    );
    expect(auditResponse.body).not.toContain("MCP secret title");
  });
  it("isolates branches, independent actions and file access without private parent metadata", async () => {
    const page = await createItemViaApi(harness.api, {
      kind: "page",
      name: "Permitted private text",
      parentItemId: branchId as import("@myownnotion/domain").Uuid,
      headers,
    });
    const { client } = await connect({
      actions: ["read", "search"],
      allContent: false,
      branchRootIds: [branchId],
      files: false,
    });
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
      "list_items",
      "read_item",
      "search",
    ]);
    const listed = await call(client, "list_items", {});
    expect(JSON.stringify(listed)).toContain("Permitted private text");
    expect(JSON.stringify(listed)).not.toContain("Private sibling title");
    expect((await call(client, "read_item", { itemId: secretId })).value).toEqual(
      (await call(client, "read_item", { itemId: randomUUID() })).value,
    );
    const isolated = await connect({
      actions: ["read"],
      allContent: false,
      branchRootIds: [page.itemId],
      files: false,
    });
    const item = await call(isolated.client, "read_item", { itemId: page.itemId });
    expect(JSON.stringify(item)).not.toContain(branchId);
    await harness.api.built.context.search?.rebuild();
    const searched = await call(client, "search", { query: "private", branchRootId: branchId });
    expect(searched.isError).toBe(false);
    expect(JSON.stringify(searched)).toContain("Permitted private text");
    expect(JSON.stringify(searched)).not.toContain("Private sibling title");
    expect(
      (await call(client, "search", { query: "private", branchRootId: secretId })).isError,
    ).toBe(true);
  });
  it("edits operational pages with exact state proof, publishes canonical revisions and rejects stale or blocked writes", async () => {
    const page = await harness.createLegacyPage("Operational MCP");
    const activated = await harness.api.built.app.inject({
      method: "POST",
      url: `/v1/page-operations/${page.itemId}/activate`,
      headers,
      payload: {
        requestId: generateUuidV7(),
        expectedRevisionId: page.revisionId,
        expectedCanonicalDigest: page.canonicalDigest,
      },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const { client } = await connect();
    const before = (await call(client, "read_item", { itemId: page.itemId })).value;
    const command = {
      mutationId: generateUuidV7(),
      pageId: page.itemId,
      expectedRevisionId: before.currentRevisionId,
      expectedDocumentDigest: before.documentDigest,
      commands: [
        {
          type: "insert-paragraph",
          blockId: generateUuidV7(),
          parentBlockId: null,
          beforeBlockId: null,
          text: "MCP convergent text",
        },
      ],
    };
    const changed = await call(client, "edit_page", command);
    expect(changed.isError, JSON.stringify(changed)).toBe(false);
    expect(await call(client, "edit_page", command)).toEqual(changed);
    expect(
      JSON.stringify((await call(client, "read_item", { itemId: page.itemId })).value.pageDocument),
    ).toContain("MCP convergent text");
    expect(
      (await call(client, "edit_page", { ...command, mutationId: generateUuidV7() })).value.code,
    ).toBe("mcp.stale-page");
    const state = await harness.api.built.database.db
      .select()
      .from(schema.pageOperationStates)
      .where(eq(schema.pageOperationStates.pageId, page.itemId));
    expect(state[0]?.status).toBe("active");
    const updates = await harness.api.built.database.db
      .select()
      .from(schema.pageOperationUpdates)
      .where(eq(schema.pageOperationUpdates.pageId, page.itemId));
    expect(updates).toHaveLength(1);
    await harness.api.built.database.db.execute(sql`INSERT INTO rotation_policies (id, installation_id, kind, due_interval_days, due_at, write_block_at)
      SELECT gen_random_uuid(), id, 'wrapping-key', 365, now() - interval '2 days', now() - interval '1 day' FROM installations`);
    expect(
      (
        await call(client, "rename_item", {
          mutationId: generateUuidV7(),
          itemId: page.itemId,
          name: "Blocked",
        })
      ).isError,
    ).toBe(true);
  });
  it("refuses foreign Origins, unauthenticated transport and revoked authorizing devices", async () => {
    const { accessToken, client } = await connect();
    const foreign = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        origin: "https://foreign.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(foreign.status).toBe(403);
    expect((await fetch(`${origin}/mcp`)).status).toBe(401);
    const wrongMethod = await fetch(`${origin}/mcp`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(wrongMethod.status).toBe(405);
    await harness.api.built.database.db.execute(
      sql`UPDATE authorized_devices SET state='revoked', revoked_at=now()`,
    );
    await expect(client.listTools()).rejects.toThrow();
  });
  it("activates a legacy page without replacing newer content and edits its stable text", async () => {
    const { client } = await connect();
    const pageId = generateUuidV7();
    expect(
      (
        await call(client, "create_item", {
          mutationId: generateUuidV7(),
          id: pageId,
          kind: "page",
          name: "Legacy edit",
          parentId: branchId,
          text: "Old text",
        })
      ).isError,
    ).toBe(false);
    const before = (await call(client, "read_item", { itemId: pageId })).value;
    const args = {
      mutationId: generateUuidV7(),
      pageId,
      expectedRevisionId: before.currentRevisionId,
      expectedDocumentDigest: before.documentDigest,
      commands: [
        { type: "replace-text", blockId: pageId, from: 0, to: 8, text: "New private text" },
      ],
    };
    expect((await call(client, "edit_page", args)).isError).toBe(false);
    const after = await call(client, "read_item", { itemId: pageId });
    expect(JSON.stringify(after)).toContain("New private text");
    expect(JSON.stringify(after)).not.toContain("Old text");
    const deleted = await call(client, "edit_page", {
      mutationId: generateUuidV7(),
      pageId,
      expectedRevisionId: after.value.currentRevisionId,
      expectedDocumentDigest: after.value.documentDigest,
      commands: [{ type: "delete-block", blockId: pageId }],
    });
    expect(deleted.isError).toBe(false);
  });
  it("reads file chunks only with explicit permission and refuses hidden descendant deletion", async () => {
    const page = await createItemViaApi(harness.api, {
      kind: "page",
      name: "Attachment page",
      parentItemId: branchId as import("@myownnotion/domain").Uuid,
      headers,
    });
    const bytes = Buffer.from("MCP private attachment bytes");
    const upload = await harness.api.built.app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: {
        ...headers,
        "upload-length": String(bytes.length),
        "upload-metadata": `filename ${Buffer.from("private.txt").toString("base64")},attachmentParentItemId ${Buffer.from(page.itemId).toString("base64")}`,
      },
    });
    expect(upload.statusCode, upload.body).toBe(201);
    const finished = await harness.api.built.app.inject({
      method: "PATCH",
      url: String(upload.headers.location),
      headers: {
        ...headers,
        "content-type": "application/offset+octet-stream",
        "upload-offset": "0",
      },
      payload: bytes,
    });
    expect(finished.statusCode, finished.body).toBe(201);
    const fileId = finished.json().itemId as string;
    const restricted = await connect({
      actions: ["read", "delete"],
      allContent: false,
      branchRootIds: [branchId],
      files: false,
    });
    expect(JSON.stringify(await call(restricted.client, "list_items", {}))).not.toContain(fileId);
    expect((await call(restricted.client, "read_item", { itemId: fileId })).isError).toBe(true);
    expect(
      (
        await call(restricted.client, "trash_item", {
          mutationId: generateUuidV7(),
          itemId: branchId,
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await harness.api.built.app.inject({ method: "GET", url: `/v1/items/${branchId}`, headers })
      ).json().lifecycle,
    ).toBe("active");
    const allowed = await connect({
      actions: ["read"],
      allContent: false,
      branchRootIds: [branchId],
      files: true,
    });
    const first = await call(allowed.client, "read_file", { itemId: fileId, offset: 0, length: 4 });
    expect(first.isError, JSON.stringify(first)).toBe(false);
    expect(Buffer.from(first.value.data, "base64").toString()).toBe("MCP ");
    const second = await call(allowed.client, "read_file", {
      itemId: fileId,
      offset: first.value.nextOffset,
    });
    expect(Buffer.from(second.value.data, "base64")).toEqual(bytes.subarray(4));
    expect(second.value.nextOffset).toBeNull();
    expect(
      (await call(allowed.client, "read_file", { itemId: fileId, offset: bytes.length + 1 }))
        .isError,
    ).toBe(true);
  });
  it("rejects invalid scopes and unlimited access without acknowledgement; enforces scoped creation", async () => {
    for (const payload of [
      { label: " ", scope: allScope },
      { label: "x", scope: { ...allScope, allContent: false } },
      { label: "x", scope: { ...allScope, branchRootIds: [branchId] } },
      { label: "x", scope: allScope, lifetimeDays: null },
      { label: "x", scope: allScope, lifetimeDays: 91 },
    ])
      expect(
        (
          await harness.api.built.app.inject({
            method: "POST",
            url: "/v1/mcp/connections",
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (await grant(allScope, { lifetimeDays: null, acknowledgeUnlimited: true })).connection
        .expiresAt,
    ).toBeNull();
    const { client } = await connect({
      actions: ["create"],
      allContent: false,
      branchRootIds: [branchId],
      files: false,
    });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["create_item"]);
    for (const parentId of [null, secretId])
      expect(
        (
          await call(client, "create_item", {
            mutationId: generateUuidV7(),
            id: generateUuidV7(),
            kind: "page",
            name: "Refused",
            parentId,
          })
        ).isError,
      ).toBe(true);
    expect(
      (
        await call(client, "create_item", {
          mutationId: generateUuidV7(),
          id: generateUuidV7(),
          kind: "folder",
          name: "Scoped creation",
          parentId: branchId,
        })
      ).isError,
    ).toBe(false);
  });
  it("never falls back to readable placeholders when an envelope is corrupt or the key unavailable", async () => {
    const { client } = await connect();
    await harness.api.built.database.db.execute(
      sql`UPDATE protected_envelopes SET ciphertext='AAAA' WHERE entity_type='item.name' AND entity_id=${secretId}`,
    );
    const read = await call(client, "read_item", { itemId: secretId });
    expect(read.isError).toBe(true);
    expect(JSON.stringify(read)).not.toContain("Private sibling title");
    const key = await readFile(harness.deploymentKeyFile);
    try {
      await rm(harness.deploymentKeyFile);
      await expect(client.listTools()).rejects.toThrow();
    } finally {
      await writeFile(harness.deploymentKeyFile, key, { mode: 0o600 });
    }
  });
  it("supports the2025 stateless handshake and rejects malformed transport input", async () => {
    const { accessToken } = await connect();
    const transportHeaders = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const initialize = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: transportHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "legacy-test", version: "1" },
        },
      }),
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.text()).toContain("2025-11-25");
    const listing = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { ...transportHeaders, "mcp-protocol-version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(listing.status).toBe(200);
    expect(await listing.text()).toContain("read_item");
    const malformed = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: transportHeaders,
      body: "{",
    });
    expect(malformed.status).toBe(400);
    const subscription = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        ...transportHeaders,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "subscriptions/listen",
        params: {
          notifications: {},
          _meta: {
            [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
            [CLIENT_CAPABILITIES_META_KEY]: {},
          },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    const subscriptionBody = await subscription.text();
    expect(subscription.status, subscriptionBody).toBe(200);
    expect(subscriptionBody).toContain("Subscription limit reached");
  });
  it("exchanges through the CLI into a new private config without printing or overwriting credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mcp-cli-"));
    try {
      const created = await grant();
      const codeFile = join(directory, "code");
      const output = join(directory, "client.json");
      await writeFile(codeFile, created.exchangeCode, { mode: 0o600 });
      await connectMcp({ server: origin, codeFile, output });
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      const config = JSON.parse(await readFile(output, "utf8"));
      expect(config.mcpServers.myownnotion.url).toBe(`${origin}/mcp`);
      expect(config.mcpServers.myownnotion.headers.Authorization).toMatch(/^Bearer mn_mcp_/);
      await expect(connectMcp({ server: origin, codeFile, output })).rejects.toThrow();
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(config);
      await expect(
        connectMcp({
          server: "http://remote.invalid",
          codeFile,
          output: join(directory, "invalid.json"),
        }),
      ).rejects.toThrow("HTTPS");
      const lines: string[] = [];
      expect(await runMcpConnect(["--help"], (line) => lines.push(line))).toBe(0);
      expect(
        await runMcpConnect(["--code", created.exchangeCode], (line) => lines.push(line)),
      ).toBe(2);
      expect(await runMcpConnect(["--server", origin], (line) => lines.push(line))).toBe(2);
      expect(
        await runMcpConnect(
          ["--server", origin, "--code-file", codeFile, "--output", output],
          (line) => lines.push(line),
        ),
      ).toBe(1);
      expect(lines.join("\n")).not.toContain(created.exchangeCode);
      expect(lines.join("\n")).not.toContain(config.mcpServers.myownnotion.headers.Authorization);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
