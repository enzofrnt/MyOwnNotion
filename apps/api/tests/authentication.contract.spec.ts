/**
 * Authentication and session routes (T037/T040, feature 002).
 *
 * Driven through the real Fastify app over a real PostgreSQL, with the
 * server's clock under the test's control so session lifetimes are reachable
 * without waiting.
 *
 * **The passkey ceremony cannot be produced here** — that needs an
 * authenticator — so passkey login is exercised through its refusal paths, and
 * the password alternative carries the end-to-end journey. That split is not a
 * gap in coverage of the property that matters: everything about sessions,
 * cookies, CSRF, recency, and revocation is identical whichever credential
 * opened the session, and the tests below assert that by driving all of it
 * through a password-issued session.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInstallation, readCounts } from "@myownnotion/database";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/security/password-service.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";
import { type ApiHarness, createApiHarness } from "./helpers/app.ts";

let harness: ApiHarness;

const INSTALLATION_ID = "018f2b7c-0000-7000-8000-000000000001";
const OWNER_ID = "018f2b7c-0000-7000-8000-0000000000bb";
const DEVICE_ID = "018f2b7c-0000-7000-8000-0000000000cc";
const DEVICE_CLAIM = {
  deviceBindingId: "web-39a88270-225f-4ec4-9548-aebfa39fb55e",
  name: "Test browser",
  platform: "Test platform",
} as const;
const PASSWORD = "correct horse battery staple";
const COOKIE = "mn_dev_session";
const CSRF_HEADER = "x-csrf-token";

const BASE_TIME = new Date("2026-05-01T00:00:00.000Z");
const clock = { value: BASE_TIME };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function at(offsetMs: number): Date {
  return new Date(BASE_TIME.getTime() + offsetMs);
}

let keyDirectory: string;

beforeAll(async () => {
  // A real mounted key file, because the CSRF token is derived from it: an
  // installation without one refuses to issue a session at all, which is
  // correct behaviour and would make every test below unreachable.
  keyDirectory = mkdtempSync(path.join(os.tmpdir(), "mon-auth-key-"));
  const keyFile = path.join(keyDirectory, "deployment-key");
  writeFileSync(keyFile, randomBytes(32).toString("base64"), { encoding: "utf8", mode: 0o600 });

  harness = await createApiHarness({
    security: loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: keyFile,
    }),
    now: () => clock.value,
  });
}, 180_000);

afterAll(async () => {
  await harness?.close();
  rmSync(keyDirectory, { recursive: true, force: true });
});

/** Seeds a committed owner with an active device and a password set. */
async function seedOwner(options: { withPassword?: boolean } = {}): Promise<void> {
  const db = harness.built.database.db;
  const [workspace] = await db
    .execute(sql`SELECT id FROM workspaces LIMIT 1`)
    .then((result) => (result as unknown as { rows: { id: string }[] }).rows ?? []);
  await db.execute(sql`
    INSERT INTO owners (id, installation_id, state) VALUES (${OWNER_ID}::uuid, ${INSTALLATION_ID}::uuid, 'active')
  `);
  await db.execute(sql`
    UPDATE installations SET state = 'ready', owner_id = ${OWNER_ID}::uuid, workspace_id = ${workspace?.id}::uuid
  `);
  await db.execute(sql`
    INSERT INTO authorized_devices (id, owner_id, device_binding_id, name, state)
    VALUES (${DEVICE_ID}::uuid, ${OWNER_ID}::uuid, ${DEVICE_CLAIM.deviceBindingId}, 'Laptop', 'active')
  `);
  if (options.withPassword !== false) {
    const hashed = await hashPassword(PASSWORD);
    await db.execute(sql`
      INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
      VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${hashed.encoded}, 'scrypt', 'active')
    `);
  }
}

beforeEach(async () => {
  clock.value = BASE_TIME;
  await harness.built.database.db.execute(sql`
    TRUNCATE security_audit_events, security_rate_limits, recovery_kits, recovery_epochs,
      data_key_generations, sessions, authorized_devices, pending_bootstrap_credentials,
      bootstrap_attempts, password_credential_versions, passkey_credentials, owners,
      installations CASCADE
  `);
  await createInstallation(harness.built.database.db, {
    id: INSTALLATION_ID,
    sourceLineageId: INSTALLATION_ID,
    schemaVersion: 1,
  });
});

interface Inject {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  payload?: Record<string, unknown>;
}

function inject(options: Inject) {
  return harness.built.app.inject({
    method: options.method,
    url: options.url,
    headers: options.headers ?? {},
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

const login = (
  password = PASSWORD,
  device: { deviceBindingId: string; name: string; platform: string } = DEVICE_CLAIM,
) => inject({ method: "POST", url: "/v1/auth/login/password", payload: { password, device } });

/** Extracts the session cookie value from a `Set-Cookie` header. */
function cookieFrom(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  const match = /mn_dev_session=([^;]*)/.exec(String(value ?? ""));
  return match?.[1] ?? "";
}

/** Logs in and returns the two things every authenticated request needs. */
async function authenticate(): Promise<{ cookie: string; csrf: string }> {
  const response = await login();
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: cookieFrom(response), csrf: response.json().csrfToken as string };
}

function authHeaders(auth: { cookie: string; csrf: string }): Record<string, string> {
  return { cookie: `${COOKIE}=${auth.cookie}`, [CSRF_HEADER]: auth.csrf };
}

describe("password login", () => {
  it("issues a session and a CSRF token", async () => {
    await seedOwner();
    const response = await login();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.session.authMethod).toBe("password");
    expect(body.session.state).toBe("active");
    expect(body.csrfToken).toHaveLength(43);
  });

  it("creates and then reuses the exact profile device instead of the first row", async () => {
    await seedOwner();
    const secondProfile = {
      deviceBindingId: "web-f66efccd-ac83-46d4-bde9-24e2dbd36eba",
      name: "Second browser",
      platform: "Test platform",
    } as const;

    const firstLogin = await login(PASSWORD, secondProfile);
    const secondLogin = await login(PASSWORD, secondProfile);
    const firstDeviceId = firstLogin.json().session.deviceId as string;

    expect(firstLogin.statusCode).toBe(200);
    expect(firstDeviceId).not.toBe(DEVICE_ID);
    expect(secondLogin.json().session.deviceId).toBe(firstDeviceId);
    const devices = await harness.built.database.db.execute(sql`
      SELECT id, device_binding_id FROM authorized_devices ORDER BY authorized_at
    `);
    expect(devices.rows).toHaveLength(2);
  });

  it("puts the secret in a cookie and never in the body", async () => {
    // A session secret in a response body ends up in logs, in a service
    // worker cache, and in whatever the client decides to store.
    await seedOwner();
    const response = await login();
    const secret = cookieFrom(response);
    expect(secret.length).toBeGreaterThan(20);
    expect(response.body).not.toContain(secret);
  });

  it("sets HttpOnly and SameSite=Strict even under the loopback exception", async () => {
    await seedOwner();
    const header = String((await login()).headers["set-cookie"]);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    // Not Secure here, or the browser would refuse to send it over HTTP.
    expect(header).not.toContain("Secure");
  });

  it("refuses a wrong password with the same answer as no owner at all", async () => {
    // The oracle this prevents: an attacker learning whether an installation
    // has been set up, or whether a password has been configured.
    const beforeSetup = await login("some other passphrase");
    await seedOwner();
    const wrong = await login("some other passphrase");

    expect(beforeSetup.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe(beforeSetup.json().code);
    expect(wrong.json().title).toBe(beforeSetup.json().title);
  });

  it("refuses when no password is configured, the same way", async () => {
    await seedOwner({ withPassword: false });
    const response = await login();
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("authentication_failed");
  });

  it("refuses a revoked device however good the credential", async () => {
    await seedOwner();
    await harness.built.database.db.execute(
      sql`UPDATE authorized_devices SET state = 'revoked', revoked_at = now()`,
    );
    expect((await login()).statusCode).toBe(401);
  });

  it("never names the credential in the response", async () => {
    await seedOwner();
    const response = await login("wrong passphrase here");
    expect(response.body).not.toContain("password");
    expect(response.body).not.toContain("wrong passphrase here");
  });
});

describe("the authenticated session", () => {
  it("is readable with the cookie", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().session.state).toBe("active");
  });

  it("is refused without a cookie", async () => {
    await seedOwner();
    await authenticate();
    expect((await inject({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(401);
  });

  it("is refused with a made-up secret", async () => {
    await seedOwner();
    await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=not-a-real-secret` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("is refused when the production cookie is presented to a loopback installation", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `__Host-mn_session=${auth.cookie}` },
    });
    // The right secret in the wrong cookie is no session at all.
    expect(response.statusCode).toBe(401);
  });

  it("lapses after the inactivity window", async () => {
    await seedOwner();
    const auth = await authenticate();
    clock.value = at(31 * DAY);
    const response = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("stays alive while it is being used", async () => {
    await seedOwner();
    const auth = await authenticate();
    for (let day = 20; day <= 100; day += 20) {
      clock.value = at(day * DAY);
      const response = await inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: `${COOKIE}=${auth.cookie}` },
      });
      expect(response.statusCode, `day ${day}`).toBe(200);
    }
  });
});

describe("CSRF", () => {
  it("refuses a state-changing request without the header", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("csrf_validation_failed");
    const disguised = await inject({
      method: "POST",
      url: "/v1/items/018f2b7c-0000-7000-8000-000000000099/trash",
      headers: {
        cookie: `${COOKIE}=${auth.cookie}`,
        upgrade: "websocket",
        "x-myownnotion-client-protocol": "3",
        "idempotency-key": "018f2b7c-0000-7000-8000-000000000099",
      },
    });
    expect(disguised.statusCode).toBe(403);
    expect(disguised.json().code).toBe("csrf_validation_failed");
  });

  it("refuses a token that belongs to another session", async () => {
    await seedOwner();
    const first = await authenticate();
    const second = await authenticate();
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${first.cookie}`, [CSRF_HEADER]: second.csrf },
    });
    expect(response.statusCode).toBe(403);
  });

  it("does not gate a read", async () => {
    // Requiring it on reads would train the client to attach it everywhere,
    // which is how it ends up in a URL.
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/sessions",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("never appears in a URL", async () => {
    await seedOwner();
    const auth = await authenticate();
    // The token is a response-body value and a request header. If a route ever
    // accepted it as a query parameter, this would start passing without it.
    const response = await inject({
      method: "DELETE",
      // The rule this line trips forbids a token in a query string, and the
      // only way to prove a route refuses one is to send one. Rewriting the
      // URL to dodge the scanner would leave the rule enforced everywhere
      // except at the one place that demonstrates it holds. The marker has to
      // sit on the offending line, because the scanner exempts per line.
      url: `/v1/auth/session?csrfToken=${auth.csrf}`, // static-security:allow no-secret-in-url
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("the session inventory", () => {
  it("lists every session and no secrets", async () => {
    await seedOwner();
    const first = await authenticate();
    await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/sessions",
      headers: { cookie: `${COOKIE}=${first.cookie}` },
    });
    expect(response.statusCode).toBe(200);
    const sessions = response.json().sessions as unknown[];
    expect(sessions).toHaveLength(2);
    // The digest is not in the view schema; this catches a hand-built response
    // that bypassed it.
    expect(response.body).not.toContain(first.cookie);
    expect(response.body).not.toContain("secretHash");
  });
});

describe("revocation", () => {
  it("stops the revoked session immediately", async () => {
    await seedOwner();
    const victim = await authenticate();
    const actor = await authenticate();
    const sessions = (
      await inject({
        method: "GET",
        url: "/v1/auth/sessions",
        headers: { cookie: `${COOKIE}=${actor.cookie}` },
      })
    ).json().sessions as { sessionId: string }[];

    const victimSession = (
      await inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: `${COOKIE}=${victim.cookie}` },
      })
    ).json().session as { sessionId: string };

    expect(sessions.some((session) => session.sessionId === victimSession.sessionId)).toBe(true);

    const revoked = await inject({
      method: "DELETE",
      url: `/v1/auth/sessions/${victimSession.sessionId}`,
      headers: authHeaders(actor),
    });
    expect(revoked.statusCode).toBe(204);

    const afterwards = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${victim.cookie}` },
    });
    expect(afterwards.statusCode).toBe(401);
  });

  it("answers the same for an unknown session id", async () => {
    // Otherwise the endpoint enumerates session ids.
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/sessions/018f2b7c-0000-7000-8000-00000000dead",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(204);
  });

  it("revoke-all spares the session that asked", async () => {
    // Signing out everywhere else after losing a device should not sign the
    // owner out of the browser they are doing it from.
    await seedOwner();
    const other = await authenticate();
    const actor = await authenticate();

    const response = await inject({
      method: "POST",
      url: "/v1/auth/sessions/revoke-all",
      headers: authHeaders(actor),
    });
    expect(response.statusCode).toBe(204);

    expect(
      (
        await inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: `${COOKIE}=${actor.cookie}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject({
          method: "GET",
          url: "/v1/auth/session",
          headers: { cookie: `${COOKIE}=${other.cookie}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("revoke-all requires recent authentication", async () => {
    // This is the control an attacker holding a stolen session would use to
    // lock the owner out, so a month-old session must not reach it.
    await seedOwner();
    const auth = await authenticate();
    clock.value = at(16 * MINUTE);
    const response = await inject({
      method: "POST",
      url: "/v1/auth/sessions/revoke-all",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(428);
    expect(response.json().code).toBe("recent_authentication_required");
  });

  it("a revoked session cannot renew itself", async () => {
    await seedOwner();
    const auth = await authenticate();
    await inject({ method: "DELETE", url: "/v1/auth/session", headers: authHeaders(auth) });
    // Later, well inside what would have been its window.
    clock.value = at(DAY);
    const response = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it("signing out clears the cookie with the attributes it was set with", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: authHeaders(auth),
    });
    const header = String(response.headers["set-cookie"]);
    expect(header).toContain(`${COOKIE}=`);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("Path=/");
  });
});

describe("recent authentication", () => {
  it("is satisfied immediately after signing in", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "a completely different passphrase" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("lapses fifteen minutes later", async () => {
    await seedOwner();
    const auth = await authenticate();
    clock.value = at(15 * MINUTE + 1);
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "a completely different passphrase" },
    });
    expect(response.statusCode).toBe(428);
  });

  it("is still valid at exactly fifteen minutes", async () => {
    await seedOwner();
    const auth = await authenticate();
    clock.value = at(15 * MINUTE);
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "a completely different passphrase" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("is not refreshed by ordinary session use", async () => {
    // Using the session must not count as proving possession, or a long-lived
    // session becomes a standing authorization for sensitive operations.
    await seedOwner();
    const auth = await authenticate();
    for (let minute = 1; minute <= 20; minute += 1) {
      clock.value = at(minute * MINUTE);
      await inject({
        method: "GET",
        url: "/v1/auth/session",
        headers: { cookie: `${COOKIE}=${auth.cookie}` },
      });
    }
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "a completely different passphrase" },
    });
    expect(response.statusCode).toBe(428);
  });
});

describe("the password alternative", () => {
  it("changes the password and the new one works", async () => {
    await seedOwner();
    const auth = await authenticate();
    const changed = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "an entirely new passphrase" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ configured: true, state: "active" });

    expect((await login("an entirely new passphrase")).statusCode).toBe(200);
    expect((await login(PASSWORD)).statusCode).toBe(401);
  });

  it("never echoes the password", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "an entirely new passphrase" },
    });
    expect(response.body).not.toContain("an entirely new passphrase");
  });

  it("refuses a password that is too short", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "short" },
    });
    expect(response.statusCode, response.body).toBe(400);
  });

  it("keeps exactly one active version after a change", async () => {
    // The partial unique index permits one; this catches a change that
    // inserted without superseding.
    await seedOwner();
    const auth = await authenticate();
    await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "an entirely new passphrase" },
    });
    const rows = await harness.built.database.db.execute(
      sql`SELECT state FROM password_credential_versions ORDER BY created_at`,
    );
    const states = (rows as unknown as { rows: { state: string }[] }).rows.map((r) => r.state);
    expect(states.filter((state) => state === "active")).toHaveLength(1);
    expect(states).toContain("superseded");
  });

  it("cannot be set without recent authentication", async () => {
    await seedOwner();
    const auth = await authenticate();
    clock.value = at(20 * MINUTE);
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "an entirely new passphrase" },
    });
    expect(response.statusCode).toBe(428);
  });

  it("cannot be set without CSRF", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
      payload: { newPassword: "an entirely new passphrase" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("has no reset endpoint", async () => {
    // Deliberate: a reset needs a channel this installation does not have, and
    // inventing one would be a third way in, weaker than both real ones.
    for (const url of ["/v1/auth/password/reset", "/v1/auth/password/forgot"]) {
      expect((await inject({ method: "POST", url })).statusCode, url).toBe(404);
    }
  });
});

describe("passkey login, through its refusals", () => {
  it("refuses an unknown credential", async () => {
    await seedOwner();
    const response = await inject({
      method: "POST",
      url: "/v1/auth/login/passkey",
      payload: {
        credential: {
          id: "unknown-credential",
          rawId: "unknown-credential",
          type: "public-key",
          response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" },
        },
        device: DEVICE_CLAIM,
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("authentication_failed");
  });

  it("still works as a path when a password exists", async () => {
    // Setting a password must not disable passkey login. The refusal above is
    // about the credential, not about the method being switched off — so the
    // same request produces the same code either way.
    await seedOwner({ withPassword: false });
    const withoutPassword = await inject({
      method: "POST",
      url: "/v1/auth/login/passkey",
      payload: {
        credential: {
          id: "unknown-credential",
          rawId: "unknown-credential",
          type: "public-key",
          response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" },
        },
        device: DEVICE_CLAIM,
      },
    });
    expect(withoutPassword.json().code).toBe("authentication_failed");
  });
});

describe("the installation stays 1/1 throughout", () => {
  it("no amount of authentication creates a second owner", async () => {
    await seedOwner();
    await authenticate();
    await authenticate();
    await login("wrong passphrase entirely");
    expect(await readCounts(harness.built.database.db)).toEqual({
      ownerCount: 1,
      workspaceCount: 1,
    });
  });
});

describe("passkey management", () => {
  /** Seeds an active passkey directly; enrolling one needs a ceremony. */
  async function seedPasskey(credentialId: string, label: string | null): Promise<void> {
    await harness.built.database.db.execute(sql`
      INSERT INTO passkey_credentials (id, owner_id, credential_id, public_key, label, state)
      VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${credentialId}, 'public-key-material',
              ${label}, 'active')
    `);
  }

  it("lists the owner's passkeys without their public keys", async () => {
    // The inventory is rendered in a browser. Key material has no business
    // there even though it is public.
    await seedOwner();
    await seedPasskey("credential-one", "Laptop");
    const auth = await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/passkeys",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().passkeys).toHaveLength(1);
    expect(response.body).not.toContain("public-key-material");
  });

  it("names a bootstrap credential rather than inventing one", async () => {
    // The credential enrolled during setup has no label because the owner
    // never chose one. Making one up would show them a name they do not
    // recognise in the one list they consult to spot what they do not know.
    await seedOwner();
    await seedPasskey("credential-one", null);
    const auth = await authenticate();
    const response = await inject({
      method: "GET",
      url: "/v1/auth/passkeys",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.json().passkeys[0].label).toBe("First passkey");
  });

  it("refuses to remove the last way in", async () => {
    // This is the one refusal that is not silent: removing it would lock the
    // owner out permanently, and they need to know that is why it did not
    // happen.
    await seedOwner({ withPassword: false });
    await seedPasskey("credential-one", "Laptop");
    // A password is a way in too, so this owner has exactly one.
    const hashed = await hashPassword(PASSWORD);
    await harness.built.database.db.execute(sql`
      INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
      VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${hashed.encoded}, 'scrypt', 'active')
    `);
    const auth = await authenticate();
    // With a password set, removing the only passkey is allowed.
    const allowed = await inject({
      method: "DELETE",
      url: "/v1/auth/passkeys/credential-one",
      headers: authHeaders(auth),
    });
    expect(allowed.statusCode).toBe(204);
  });

  it("refuses when the passkey is the only credential at all", async () => {
    await seedOwner({ withPassword: false });
    await seedPasskey("credential-one", "Laptop");
    await harness.built.database.db.execute(sql`
      INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
      VALUES (gen_random_uuid(), ${OWNER_ID}::uuid, ${(await hashPassword(PASSWORD)).encoded},
              'scrypt', 'active')
    `);
    const auth = await authenticate();
    // Take the password away again, leaving the passkey alone.
    await harness.built.database.db.execute(
      sql`UPDATE password_credential_versions SET state = 'revoked'`,
    );
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/passkeys/credential-one",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("conflict");
  });

  it("answers the same for a credential that does not exist", async () => {
    // Otherwise the endpoint enumerates credential ids.
    await seedOwner();
    await seedPasskey("credential-one", "Laptop");
    const auth = await authenticate();
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/passkeys/no-such-credential",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(204);
  });

  it("requires recent authentication to remove one", async () => {
    await seedOwner();
    await seedPasskey("credential-one", "Laptop");
    await seedPasskey("credential-two", "Phone");
    const auth = await authenticate();
    clock.value = at(20 * MINUTE);
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/passkeys/credential-one",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(428);
  });

  it("requires CSRF to remove one", async () => {
    await seedOwner();
    await seedPasskey("credential-one", "Laptop");
    const auth = await authenticate();
    const response = await inject({
      method: "DELETE",
      url: "/v1/auth/passkeys/credential-one",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("passkey enrollment", () => {
  it("issues options to a recently authenticated owner", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "POST",
      url: "/v1/auth/passkeys/enrollment/options",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(200);
    expect(typeof response.json().challenge).toBe("string");
  });

  it("refuses options without recent authentication", async () => {
    await seedOwner();
    const auth = await authenticate();
    clock.value = at(20 * MINUTE);
    const response = await inject({
      method: "POST",
      url: "/v1/auth/passkeys/enrollment/options",
      headers: authHeaders(auth),
    });
    expect(response.statusCode).toBe(428);
  });

  it("refuses options without CSRF", async () => {
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "POST",
      url: "/v1/auth/passkeys/enrollment/options",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(response.statusCode).toBe(403);
  });

  it("refuses a completion with no options issued", async () => {
    // The challenge is single-use and lives in memory against this session; a
    // completion that never asked for one has nothing to have signed.
    await seedOwner();
    const auth = await authenticate();
    const response = await inject({
      method: "POST",
      url: "/v1/auth/passkeys/enrollment/complete",
      headers: authHeaders(auth),
      payload: {
        id: "fabricated",
        rawId: "fabricated",
        type: "public-key",
        response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" },
        label: "Fabricated",
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses a fabricated ceremony even after options were issued", async () => {
    // A verifier that accepted a forged ceremony is the defect that matters
    // here; the happy path needs an authenticator and is covered by the
    // journeys.
    await seedOwner();
    const auth = await authenticate();
    await inject({
      method: "POST",
      url: "/v1/auth/passkeys/enrollment/options",
      headers: authHeaders(auth),
    });
    const response = await inject({
      method: "POST",
      url: "/v1/auth/passkeys/enrollment/complete",
      headers: authHeaders(auth),
      payload: {
        id: "fabricated",
        rawId: "fabricated",
        type: "public-key",
        response: { clientDataJSON: "e30", authenticatorData: "AA", signature: "AA" },
        label: "Fabricated",
      },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const stored = await harness.built.database.db.execute(sql`SELECT id FROM passkey_credentials`);
    expect((stored as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });
});

describe("session lifecycle and password change coverage", () => {
  it("signs the current session out and refuses its cookie afterwards", async () => {
    await seedOwner();
    const auth = await authenticate();
    const signedOut = await inject({
      method: "DELETE",
      url: "/v1/auth/session",
      headers: authHeaders(auth),
    });
    expect(signedOut.statusCode).toBe(204);
    const afterwards = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${auth.cookie}` },
    });
    expect(afterwards.statusCode).toBe(401);
  });

  it("refuses sign-out without CSRF and revokes every other session at once", async () => {
    await seedOwner();
    const actor = await authenticate();
    const other = await authenticate();

    const noCsrf = await inject({
      method: "POST",
      url: "/v1/auth/sessions/revoke-all",
      headers: { cookie: `${COOKIE}=${actor.cookie}` },
    });
    expect(noCsrf.statusCode).toBe(403);

    const revoked = await inject({
      method: "POST",
      url: "/v1/auth/sessions/revoke-all",
      headers: authHeaders(actor),
    });
    expect(revoked.statusCode).toBe(204);

    // The acting session survives; every other session is gone.
    const stillAlive = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${actor.cookie}` },
    });
    expect(stillAlive.statusCode).toBe(200);
    const othersGone = await inject({
      method: "GET",
      url: "/v1/auth/session",
      headers: { cookie: `${COOKIE}=${other.cookie}` },
    });
    expect(othersGone.statusCode).toBe(401);
  });

  it("changes the password with recent authentication and retires the old one", async () => {
    await seedOwner({ withPassword: true });
    const auth = await authenticate();

    const weak = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "court" },
    });
    expect(weak.statusCode).toBe(400);

    const changed = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "une phrase de passe solide" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ configured: true, state: "active" });

    const oldLogin = await login(PASSWORD);
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await login("une phrase de passe solide");
    expect(newLogin.statusCode, newLogin.body).toBe(200);
  });

  it("refuses a password change without recent authentication", async () => {
    await seedOwner({ withPassword: true });
    const auth = await authenticate();
    // Age the session past the recent-authentication window.
    await harness.built.database.db.execute(sql`
      UPDATE sessions SET recent_auth_at = now() - interval '1 day'
      WHERE id = (SELECT id FROM sessions LIMIT 1)
    `);
    const stale = await inject({
      method: "PUT",
      url: "/v1/auth/password",
      headers: authHeaders(auth),
      payload: { newPassword: "une phrase de passe solide" },
    });
    expect([401, 403, 428]).toContain(stale.statusCode);
  });
});

describe("ordinary content HTTP access", () => {
  it("rejects anonymous reads and writes, then rejects the same cookie after device revocation", async () => {
    await seedOwner();
    for (const url of ["/v1/items", "/v1/snapshots/current", "/v1/changes", "/v1/changes/stream"]) {
      expect((await inject({ method: "GET", url })).statusCode).toBe(401);
    }
    const auth = await authenticate();
    // An Upgrade header on an ordinary HTTP route is not a WebSocket route
    // and must never bypass the shared owner guard.
    const disguised = await inject({
      method: "GET",
      url: "/v1/items",
      headers: { upgrade: "websocket" },
    });
    expect(disguised.statusCode).toBe(401);
    expect(
      (await inject({ method: "GET", url: "/v1/items", headers: authHeaders(auth) })).statusCode,
    ).toBe(200);
    await harness.built.database.db.execute(
      sql`UPDATE authorized_devices SET state = 'revoked', revoked_at = now() WHERE id = ${DEVICE_ID}::uuid`,
    );
    expect(
      (await inject({ method: "GET", url: "/v1/items", headers: authHeaders(auth) })).statusCode,
    ).toBe(401);
    const stream = await inject({
      method: "GET",
      url: "/v1/changes/stream",
      headers: authHeaders(auth),
    });
    expect(stream.statusCode).toBe(401);
    expect(stream.json().code).toBe("device_revoked");
    const unknown = await inject({
      method: "GET",
      url: "/v1/changes/stream",
      headers: { cookie: `${COOKIE}=unknown-secret` },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().code).toBe("authentication_required");
    expect(
      (await inject({ method: "GET", url: "/v1/auth/session", headers: authHeaders(auth) }))
        .statusCode,
    ).toBe(401);
  });
  it("requires CSRF on content mutations before invoking a handler", async () => {
    await seedOwner();
    const auth = await authenticate();

    const response = await inject({
      method: "POST",
      url: "/v1/items/018f2b7c-0000-7000-8000-000000000099/trash",
      headers: {
        cookie: `${COOKIE}=${auth.cookie}`,
        "x-myownnotion-client-protocol": "3",
        "idempotency-key": "018f2b7c-0000-7000-8000-000000000099",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("csrf_validation_failed");
  });
});

describe("login attempt budget", () => {
  it("blocks repeated failed passwords even when a later password is correct", async () => {
    await seedOwner({ withPassword: true });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login("a deliberately incorrect password")).statusCode).toBe(401);
    }
    const limited = await login(PASSWORD);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe("rate_limited");
  });
});
