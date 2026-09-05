/** Real owner cookie for encryption/content fixtures that previously wrote anonymously. */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { InjectOptions, LightMyRequestResponse as Response } from "fastify";
import { digestSessionSecret } from "../../src/security/session-service.ts";
import type { ApiHarness } from "./app.ts";

export async function authenticatedContent(
  harness: ApiHarness,
): Promise<((options: InjectOptions) => Promise<Response>) & { headers: Record<string, string> }> {
  const db = harness.built.database.db;
  const installation = "018f2b7c-0000-7000-8000-000000000001";
  const ownerId = randomUUID();
  const deviceId = randomUUID();
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  await db.execute(
    sql`INSERT INTO owners (id, installation_id, state) VALUES (${ownerId}::uuid, ${installation}::uuid, 'active')`,
  );
  await db.execute(
    sql`UPDATE installations SET state = 'ready', owner_id = ${ownerId}::uuid, workspace_id = ${harness.built.context.workspaceId}::uuid WHERE id = ${installation}::uuid`,
  );
  await db.execute(
    sql`INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state) VALUES (${deviceId}::uuid, ${ownerId}::uuid, ${`fixture-${deviceId}`}, 'Content fixture', 'active')`,
  );
  await db.execute(
    sql`INSERT INTO sessions (id, owner_id, device_id, session_secret_hash, auth_method, issued_at, last_seen_at, expires_at, recent_auth_at, state) VALUES (${sessionId}::uuid, ${ownerId}::uuid, ${deviceId}::uuid, ${digestSessionSecret(secret)}, 'password', now(), now(), now() + interval '30 days', now(), 'active')`,
  );
  const cookie = `mn_dev_session=${secret}`;
  const response = await harness.built.app.inject({
    method: "GET",
    url: "/v1/auth/session",
    headers: { cookie },
  });
  if (response.statusCode !== 200)
    throw new Error(`Could not authenticate content fixture: ${response.statusCode}`);
  const csrf = response.json().csrfToken as string;
  const inject = (options: InjectOptions) =>
    harness.built.app.inject({
      ...options,
      headers: { cookie, "x-csrf-token": csrf, ...options.headers },
    });
  return Object.assign(inject, { headers: { cookie, "x-csrf-token": csrf } });
}
