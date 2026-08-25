// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOwnerPasskey } from "../src/features/auth/passkey-client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("passkey authentication", () => {
  it("runs navigator.credentials.get and serializes the complete assertion", async () => {
    const get = vi.fn().mockResolvedValue({
      id: "credential-id",
      rawId: Uint8Array.from([1, 2]).buffer,
      type: "public-key",
      response: {
        clientDataJSON: Uint8Array.from([3]).buffer,
        authenticatorData: Uint8Array.from([4]).buffer,
        signature: Uint8Array.from([5]).buffer,
        userHandle: Uint8Array.from([6]).buffer,
      },
      getClientExtensionResults: () => ({ credProps: true }),
    });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    vi.stubGlobal("PublicKeyCredential", class {});
    vi.stubGlobal("navigator", { credentials: { get } });

    const result = await requestOwnerPasskey({ challenge: "AQIDBA" });

    expect(result).toEqual({
      ok: true,
      credential: {
        id: "credential-id",
        rawId: "AQI",
        type: "public-key",
        response: {
          clientDataJSON: "Aw",
          authenticatorData: "BA",
          signature: "BQ",
          userHandle: "Bg",
        },
        clientExtensionResults: { credProps: true },
      },
    });
    expect(get).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({
        challenge: Uint8Array.from([1, 2, 3, 4]),
        userVerification: "required",
      }),
    });
  });

  it("returns cancellation without sending an assertion", async () => {
    const get = vi.fn().mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    vi.stubGlobal("PublicKeyCredential", class {});
    vi.stubGlobal("navigator", { credentials: { get } });

    await expect(requestOwnerPasskey({ challenge: "AQIDBA" })).resolves.toEqual({
      ok: false,
      failure: "cancelled",
    });
  });
});
