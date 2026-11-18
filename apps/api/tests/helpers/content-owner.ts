/**
 * Real accounts for suites that drive the secured app (feature 058).
 *
 * `createAccount` goes through the product's own routes: the first account
 * is the administrator created by `POST /v1/bootstrap`, later ones are
 * created by that administrator, then signed in with their password. Each
 * returns an `inject` bound to its own cookie and CSRF token, so a suite can
 * act as two people side by side.
 */
import { randomUUID } from "node:crypto";
import type { Uuid } from "@myownnotion/domain";
import { sql } from "drizzle-orm";
import type { InjectOptions, LightMyRequestResponse as Response } from "fastify";
import type { ApiHarness } from "./app.ts";

export type AccountInject = ((options: InjectOptions) => Promise<Response>) & {
  readonly headers: Record<string, string>;
  readonly accountId: Uuid;
  readonly workspaceId: Uuid;
  readonly email: string;
  readonly password: string;
};

const PASSWORD = "correct horse battery staple";

export function browserDevice(name = "Fixture browser") {
  return { deviceBindingId: `web-${randomUUID()}`, name, platform: "test" };
}

function cookieFrom(response: Response): string {
  const header = response.headers["set-cookie"];
  const first = Array.isArray(header) ? header[0] : header;
  if (typeof first !== "string") throw new Error("no session cookie was issued");
  return first.split(";")[0] as string;
}

async function bind(
  harness: ApiHarness,
  response: Response,
  input: { email: string; password: string },
): Promise<AccountInject> {
  const cookie = cookieFrom(response);
  const body = response.json() as {
    account: { accountId: string };
    csrfToken: string;
  };
  const me = await harness.built.app.inject({ method: "GET", url: "/v1/me", headers: { cookie } });
  if (me.statusCode !== 200) throw new Error(`could not read the new account: ${me.statusCode}`);
  // Test-only lookup: the product never exposes a workspace id.
  const workspace = await harness.built.database.db.execute<{ workspace_id: string }>(
    sql`SELECT workspace_id FROM owners WHERE id = ${body.account.accountId}::uuid`,
  );
  const workspaceId = workspace.rows[0]?.workspace_id as Uuid;
  const headers = { cookie, "x-csrf-token": body.csrfToken };
  const inject = (options: InjectOptions) =>
    harness.built.app.inject({ ...options, headers: { ...headers, ...options.headers } });
  return Object.assign(inject, {
    headers,
    accountId: body.account.accountId as Uuid,
    workspaceId,
    email: input.email,
    password: input.password,
  });
}

/** Creates the administrator on a fresh installation, signed in. */
export async function createAdministrator(
  harness: ApiHarness,
  input: { email?: string; pseudonym?: string; password?: string } = {},
): Promise<AccountInject> {
  const email = input.email ?? `admin-${randomUUID()}@example.test`;
  const password = input.password ?? PASSWORD;
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/bootstrap",
    ...(harness.requestHeaders === undefined ? {} : { headers: harness.requestHeaders }),
    payload: {
      email,
      pseudonym: input.pseudonym ?? "Admin",
      password,
      device: browserDevice("Administrator browser"),
    },
  });
  if (response.statusCode !== 201)
    throw new Error(`bootstrap failed: ${response.statusCode} ${response.body}`);
  return await bind(harness, response, { email, password });
}

/** Signs an existing account in with its password, on a fresh device. */
export async function signIn(
  harness: ApiHarness,
  input: { email: string; password: string },
): Promise<AccountInject> {
  const response = await harness.built.app.inject({
    method: "POST",
    url: "/v1/auth/login/password",
    ...(harness.requestHeaders === undefined ? {} : { headers: harness.requestHeaders }),
    // A distinct simulated address per sign-in, so a suite that signs many
    // accounts in does not trip the per-origin abuse limit it is not testing.
    remoteAddress: `10.58.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    payload: { email: input.email, password: input.password, device: browserDevice() },
  });
  if (response.statusCode !== 200)
    throw new Error(`sign-in failed: ${response.statusCode} ${response.body}`);
  // Login answers 200 with the session; `bind` reads the same shape plus /me.
  const body = response.json() as { csrfToken: string };
  const cookie = cookieFrom(response);
  const me = await harness.built.app.inject({ method: "GET", url: "/v1/me", headers: { cookie } });
  const account = me.json() as { accountId: string };
  const fake = {
    headers: response.headers,
    json: () => ({ account, csrfToken: body.csrfToken }),
  } as unknown as Response;
  return await bind(harness, fake, input);
}

/** A member created by `administrator`, then signed in on its own device. */
export async function createMember(
  harness: ApiHarness,
  administrator: AccountInject,
  input: { email?: string; pseudonym?: string; password?: string } = {},
): Promise<AccountInject> {
  const email = input.email ?? `member-${randomUUID()}@example.test`;
  const password = input.password ?? PASSWORD;
  const created = await administrator({
    method: "POST",
    url: "/v1/admin/accounts",
    payload: { email, pseudonym: input.pseudonym ?? "Member", password },
  });
  if (created.statusCode !== 201)
    throw new Error(`member creation failed: ${created.statusCode} ${created.body}`);
  return await signIn(harness, { email, password });
}

/**
 * The account most suites need: the administrator of a fresh installation,
 * also recorded as the harness's workspace.
 */
export async function authenticatedContent(harness: ApiHarness): Promise<AccountInject> {
  const account = await createAdministrator(harness);
  harness.workspaceId = account.workspaceId;
  return account;
}
