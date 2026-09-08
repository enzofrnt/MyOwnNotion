import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createChallenge,
  verifyAssertion,
  WebAuthnVerificationError,
} from "../src/security/webauthn-service.ts";

const now = new Date("2026-09-05T10:00:00Z");
const rp = {
  id: "notes.example.com",
  origin: "https://notes.example.com",
  origins: ["https://notes.example.com", "myownnotion://app"],
  name: "MyOwnNotion",
};
function assertion(
  options: { origin?: string; counter?: number; userVerified?: boolean; challenge?: string } = {},
) {
  const challenge = createChallenge(now);
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = keys.publicKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y) throw new Error("Generated key lacks EC coordinates");
  // COSE EC2 / ES256 / P-256, followed by the 32-byte x and y coordinates.
  const publicKey = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y, "base64url"),
  ]);
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: "webauthn.get",
      challenge: options.challenge ?? challenge.challenge,
      origin: options.origin ?? rp.origin,
    }),
  );
  const authenticatorData = Buffer.alloc(37);
  createHash("sha256").update(rp.id).digest().copy(authenticatorData);
  authenticatorData[32] = options.userVerified === false ? 1 : 5;
  authenticatorData.writeUInt32BE(options.counter ?? 2, 33);
  const signature = sign(
    "sha256",
    Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]),
    keys.privateKey,
  );
  return {
    challenge,
    relyingParty: rp,
    now,
    credential: {
      credentialId: "Y3JlZGVudGlhbA",
      publicKey: publicKey.toString("base64url"),
      signCount: 1,
    },
    response: {
      id: "Y3JlZGVudGlhbA",
      rawId: "Y3JlZGVudGlhbA",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    },
  };
}

describe("real WebAuthn assertion verification", () => {
  it.each(rp.origins)(
    "accepts a valid signed assertion from configured origin %s",
    async (origin) => {
      expect(await verifyAssertion(assertion({ origin }))).toMatchObject({
        signCount: 2,
        userVerified: true,
      });
    },
  );
  it.each([
    { origin: "https://attacker.example" },
    { challenge: "wrong-challenge" },
    { counter: 1 },
    { userVerified: false },
  ])("rejects a correctly signed assertion violating ceremony policy: %j", async (options) => {
    await expect(verifyAssertion(assertion(options))).rejects.toBeInstanceOf(
      WebAuthnVerificationError,
    );
  });
  it("rejects expired challenges and altered signatures with the same public error", async () => {
    const expired = assertion();
    await expect(
      verifyAssertion({ ...expired, now: new Date(now.getTime() + 300_001) }),
    ).rejects.toBeInstanceOf(WebAuthnVerificationError);
    const forged = assertion();
    forged.response.response.signature = Buffer.alloc(64).toString("base64url");
    await expect(verifyAssertion(forged)).rejects.toBeInstanceOf(WebAuthnVerificationError);
  });
});
