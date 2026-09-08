import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { withBoundedDatabaseClient } from "./bounded-database.ts";

/**
 * Encodes a password in the stored format, at deliberately cheap parameters.
 *
 * A stored hash carries its own parameters and the server verifies against
 * those, so a fixture need not pay the production cost — which is 256 MB of
 * synchronous work per test, for nothing. Cheap parameters also exercise the
 * versioned-hash property rather than working around it: if verification ever
 * stopped reading the parameters from the row, every journey here would start
 * failing to sign in.
 *
 * The format is duplicated rather than imported because `apps/api` is not on
 * the end-to-end module path; a drift shows up immediately as a refused
 * sign-in, which is loud rather than silent.
 */
function encodePassword(password: string): string {
  const N = 16_384;
  const r = 8;
  const p = 1;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N, r, p, maxmem: 256 * N * r });
  return [
    "scrypt",
    String(N),
    String(r),
    String(p),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function seedPassword(password: string): Promise<void> {
  const credentialId = randomUUID();
  const hash = encodePassword(password);
  await withBoundedDatabaseClient("myownnotion-e2e-password-seed", async (client) => {
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM owners LIMIT 1`);
    const ownerId = rows[0]?.id;
    if (ownerId === undefined) {
      return;
    }
    await client.query(
      `INSERT INTO password_credential_versions (id, owner_id, password_hash, hash_algorithm, state)
       VALUES ($1, $2, $3, 'scrypt', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [credentialId, ownerId, hash],
    );
  });
}
