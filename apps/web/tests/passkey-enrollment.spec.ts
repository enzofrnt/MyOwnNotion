import { expect, it, vi } from "vitest";
import { enrollAccountPasskey } from "../src/features/auth/passkey-enrollment.ts";
import type { SecurityApi } from "../src/services/security-api.ts";

it("reports a stale session as recoverable so the caller can ask for the password", async () => {
  const api = {
    me: vi.fn().mockResolvedValue({
      ok: true,
      value: { accountId: "a1", email: "a@b.co", pseudonym: "A" },
    }),
    passkeyEnrollmentOptions: vi.fn().mockResolvedValue({
      ok: false,
      problem: { code: "recent_authentication_required", status: 428 },
    }),
  };
  const outcome = await enrollAccountPasskey(api as unknown as SecurityApi, { label: "x" });
  expect(outcome).toEqual({ ok: false, reason: "reauthenticate" });
});

it("keeps any other refusal as a plain refusal", async () => {
  const api = {
    me: vi
      .fn()
      .mockResolvedValue({ ok: true, value: { accountId: "a1", email: "e", pseudonym: "p" } }),
    passkeyEnrollmentOptions: vi.fn().mockResolvedValue({
      ok: false,
      problem: { code: "service_unavailable", status: 503 },
    }),
  };
  const outcome = await enrollAccountPasskey(api as unknown as SecurityApi, { label: "x" });
  expect(outcome).toEqual({ ok: false, reason: "refused" });
});
