import { describe, expect, it } from "vitest";
import { hasExactRealtimeOrigin } from "../src/security/realtime-authorization.ts";

function requestWith(origin: string | string[] | undefined) {
  return { headers: origin === undefined ? {} : { origin } } as never;
}

const httpsOrigin = new URL("https://localhost:8443");
const httpOrigin = new URL("http://localhost:8080");

describe("hasExactRealtimeOrigin", () => {
  it("accepts the public origin byte for byte", () => {
    expect(hasExactRealtimeOrigin(requestWith("https://localhost:8443"), [httpsOrigin])).toBe(true);
  });

  it("accepts the extra loopback HTTP origin used by the local helper", () => {
    expect(
      hasExactRealtimeOrigin(requestWith("http://localhost:8080"), [httpsOrigin, httpOrigin]),
    ).toBe(true);
  });

  it("refuses a trailing slash, a different host, and a missing header", () => {
    const trusted = [httpsOrigin, httpOrigin];
    expect(hasExactRealtimeOrigin(requestWith("https://localhost:8443/"), trusted)).toBe(false);
    expect(hasExactRealtimeOrigin(requestWith("http://127.0.0.1:8080"), trusted)).toBe(false);
    expect(hasExactRealtimeOrigin(requestWith("http://localhost:5173"), trusted)).toBe(false);
    expect(hasExactRealtimeOrigin(requestWith(undefined), trusted)).toBe(false);
  });
});
