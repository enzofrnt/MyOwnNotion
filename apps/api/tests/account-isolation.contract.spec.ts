/**
 * Isolation between accounts (feature 058, US3 + US4, SC-003).
 *
 * Account A owns content; account B tries every route the API has, with A's
 * identifiers, and must receive exactly what it receives for an identifier
 * that does not exist. Lists, search, changes, snapshots and export of B must
 * never contain A's content. A's MCP access must not reach B, and B never sees
 * A's MCP connections.
 *
 * The route list is read from the app itself, so a route added later is
 * covered without anyone remembering to add it here.
 */
import { randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { generateUuidV7, type Uuid } from "@myownnotion/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ApiHarness,
  createItemViaApi,
  createSecuredApiHarness,
  idempotencyHeaders,
} from "./helpers/app.ts";
import { type AccountInject, createAdministrator, createMember } from "./helpers/content-owner.ts";

let harness: ApiHarness;
let alice: AccountInject;
let bob: AccountInject;
let origin: string;
const secret = `ALPHA-SECRET-${randomUUID()}`;
const ids: Record<string, string> = {};
const clients: Client[] = [];

beforeAll(async () => {
  harness = await createSecuredApiHarness();
  alice = await createAdministrator(harness, { email: "alice@example.test", pseudonym: "Alice" });
  bob = await createMember(harness, alice, { email: "bob@example.test", pseudonym: "Bob" });

  const folder = await createItemViaApi(harness, {
    kind: "folder",
    name: `${secret} folder`,
    headers: alice.headers,
  });
  const page = await createItemViaApi(harness, {
    kind: "page",
    name: `${secret} page`,
    parentItemId: folder.itemId,
    headers: alice.headers,
  });
  ids["item"] = page.itemId;
  ids["folder"] = folder.itemId;
  ids["revision"] = page.revisionId;
  ids["placement"] = page.placementId;
  const session = (await alice({ method: "GET", url: "/v1/auth/session" })).json().session;
  ids["session"] = session.sessionId;
  ids["device"] = session.deviceId;
  ids["account"] = alice.accountId;
  const granted = await alice({
    method: "POST",
    url: "/v1/mcp/connections",
    payload: {
      label: "Alice assistant",
      scope: {
        actions: ["read", "search", "create", "edit", "delete"],
        allContent: true,
        branchRootIds: [],
        files: true,
      },
    },
  });
  expect(granted.statusCode, granted.body).toBe(200);
  ids["connection"] = granted.json().connection.id;
  ids["exchangeCode"] = granted.json().exchangeCode;
  origin = await harness.built.app.listen({ host: "127.0.0.1", port: 0 });
}, 180_000);

afterAll(async () => {
  for (const client of clients) await client.close().catch(() => undefined);
  await harness?.close();
});

/** The identifier of A's that a route parameter most plausibly names. */
function aliceValue(parameter: string): string {
  const name = parameter.toLowerCase();
  if (name.includes("session")) return ids["session"] as string;
  if (name.includes("device")) return ids["device"] as string;
  if (name.includes("connection")) return ids["connection"] as string;
  if (name.includes("account")) return ids["account"] as string;
  if (name.includes("revision")) return ids["revision"] as string;
  if (name.includes("placement")) return ids["placement"] as string;
  return ids["item"] as string;
}

function fill(url: string, value: (parameter: string) => string): string {
  return url.replace(/:([A-Za-z]+)/g, (_match, parameter: string) => value(parameter));
}

/** Removes what legitimately differs between two refusals: ids and timing. */
function normalize(body: string): string {
  return body
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"(issuedAt|occurredAt|lastSeenAt|expiresAt|now|serverTime)":"[^"]*"/g, '"$1":"<t>"');
}

const SKIPPED = new Set([
  // Opens a WebSocket; covered by the realtime hub isolation tests.
  "GET /v1/page-sync/socket",
]);

describe("every private route answers B for A's identifiers exactly as for nothing", () => {
  it("covers the whole route table", async () => {
    const routes = harness.built.routeTable.filter(
      (route) =>
        route.url.startsWith("/v1/") &&
        route.url.includes(":") &&
        route.method !== "HEAD" &&
        route.method !== "OPTIONS" &&
        !SKIPPED.has(`${route.method} ${route.url}`),
    );
    expect(routes.length).toBeGreaterThan(20);
    const leaks: string[] = [];
    for (const route of routes) {
      const request = (url: string) =>
        bob({
          method: route.method as "GET",
          url,
          headers: idempotencyHeaders(),
          ...(["POST", "PUT", "PATCH"].includes(route.method) ? { payload: {} } : {}),
        });
      const onAlice = await request(fill(route.url, aliceValue));
      const onNothing = await request(fill(route.url, () => generateUuidV7()));
      const same =
        onAlice.statusCode === onNothing.statusCode &&
        normalize(onAlice.body) === normalize(onNothing.body);
      if (!same || onAlice.body.includes(secret))
        leaks.push(
          `${route.method} ${route.url}: ${onAlice.statusCode} vs ${onNothing.statusCode} ${onAlice.body.slice(0, 160)}`,
        );
    }
    expect(leaks).toEqual([]);
  });

  it("never lets A's content into B's lists, changes, snapshot, search or export", async () => {
    const reads = [
      bob({ method: "GET", url: "/v1/items" }),
      bob({ method: "GET", url: "/v1/changes" }),
      bob({ method: "GET", url: "/v1/snapshots/current" }),
      bob({ method: "GET", url: "/v1/mcp/connections" }),
      bob({ method: "GET", url: "/v1/devices" }),
      bob({ method: "GET", url: "/v1/auth/sessions" }),
      bob({ method: "GET", url: "/v1/security/audit" }),
      bob({ method: "GET", url: "/v1/mcp/audit" }),
      bob({ method: "POST", url: "/v1/search", payload: { query: secret } }),
      bob({ method: "POST", url: "/v1/export", headers: idempotencyHeaders(), payload: {} }),
    ];
    for (const [index, response] of (await Promise.all(reads)).entries()) {
      expect(response.body, `read ${index}`).not.toContain(secret);
      for (const id of [ids["item"], ids["folder"], ids["connection"], ids["session"]])
        expect(response.body, `read ${index}`).not.toContain(id as string);
    }
  });

  it("finds A's content for A, so the checks above are not vacuous", async () => {
    const own = await alice({ method: "GET", url: `/v1/items/${ids["item"]}` });
    expect(own.statusCode).toBe(200);
    expect(own.body).toContain(secret);
    const theirs = await bob({ method: "GET", url: `/v1/items/${ids["item"]}` });
    expect(theirs.statusCode).toBe(404);
  });

  it("keeps B's writes out of A's workspace", async () => {
    const created = await bob({
      method: "POST",
      url: "/v1/items",
      headers: idempotencyHeaders(),
      payload: {
        id: generateUuidV7(),
        kind: "folder",
        name: "Bob's own folder",
        placement: { kind: "hierarchy", parentItemId: ids["folder"], positionKey: "V" },
      },
    });
    // B cannot attach to A's folder; it is not something B can see.
    expect(created.statusCode).not.toBe(201);
    const listed = await alice({ method: "GET", url: "/v1/items" });
    expect(listed.body).not.toContain("Bob's own folder");
  });
});

describe("MCP stays inside its owner's notes (US4)", () => {
  async function connectAs(account: AccountInject) {
    const granted = await account({
      method: "POST",
      url: "/v1/mcp/connections",
      payload: {
        label: "Assistant",
        scope: { actions: ["read", "search"], allContent: true, branchRootIds: [], files: true },
      },
    });
    const exchanged = await harness.built.app.inject({
      method: "POST",
      url: "/mcp/exchange",
      payload: { code: granted.json().exchangeCode },
    });
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    const client = new Client({ name: "isolation-test", version: "1.0.0" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/mcp", origin), {
        requestInit: { headers: { authorization: `Bearer ${exchanged.json().accessToken}` } },
      }),
    );
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return { isError: result.isError === true, text: content[0]?.text ?? "" };
  }

  it("lets B's assistant neither read, list nor find A's notes", async () => {
    const client = await connectAs(bob);
    const read = await call(client, "read_item", { itemId: ids["item"] });
    expect(read.isError).toBe(true);
    expect(read.text).not.toContain(secret);
    const listed = await call(client, "list_items", {});
    expect(listed.text).not.toContain(secret);
    const found = await call(client, "search", { query: secret });
    expect(found.text).not.toContain(secret);
  });

  it("lets A's assistant read A's notes", async () => {
    const client = await connectAs(alice);
    const read = await call(client, "read_item", { itemId: ids["item"] });
    expect(read.isError).toBe(false);
    expect(read.text).toContain(secret);
  });

  it("refuses an exchange code of A's to anyone through B's settings", async () => {
    const listed = await bob({ method: "GET", url: "/v1/mcp/connections" });
    expect(listed.body).not.toContain(ids["connection"] as Uuid);
    const revoke = await bob({
      method: "POST",
      url: `/v1/mcp/connections/${ids["connection"]}/revoke`,
    });
    const revokeNothing = await bob({
      method: "POST",
      url: `/v1/mcp/connections/${generateUuidV7()}/revoke`,
    });
    expect(revoke.statusCode).toBe(revokeNothing.statusCode);
    // A's connection is untouched by B's attempt.
    const own = await alice({ method: "GET", url: "/v1/mcp/connections" });
    expect(own.body).toContain(ids["connection"]);
  });
});
