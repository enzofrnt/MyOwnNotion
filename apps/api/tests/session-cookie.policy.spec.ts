/**
 * Session cookie policy (T039, feature 002).
 *
 * These assert the attributes and, more importantly, the *acceptance*
 * predicate. Getting the attributes right on issuance is the easy half; the
 * half that matters is that a production installation refuses the development
 * cookie outright, because that is the cookie an attacker who can write over
 * plain HTTP would try to set.
 *
 * No database and no server: these are decisions about strings and
 * configuration, and testing them directly keeps them falsifiable without a
 * container.
 */

import { describe, expect, it } from "vitest";
import {
  acceptsCookieName,
  DEVELOPMENT_SESSION_COOKIE,
  PRODUCTION_SESSION_COOKIE,
  parseCookies,
  readSessionSecret,
  serializeSessionCookie,
  sessionCookieAttributes,
  sessionCookieName,
} from "../src/security/cookie-policy.ts";
import { loadSecurityConfig } from "../src/security/security-config.ts";

const production = loadSecurityConfig({
  MYOWNNOTION_PUBLIC_ORIGIN: "https://notes.example.test",
  MYOWNNOTION_API_HOST: "127.0.0.1",
});

const loopback = loadSecurityConfig({
  MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
  MYOWNNOTION_API_HOST: "127.0.0.1",
  MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
});

/** A request-shaped object with just the header the reader looks at. */
function requestWith(cookie: string | undefined) {
  return { headers: cookie === undefined ? {} : { cookie } } as never;
}

describe("the production cookie", () => {
  const attributes = sessionCookieAttributes(production, 3600);

  it("uses the __Host- prefix", () => {
    // The prefix is enforced by the browser: it refuses the cookie unless it
    // is Secure, Path=/, and has no Domain. That makes the guarantee
    // browser-level rather than a promise this server keeps.
    expect(attributes.name).toBe(PRODUCTION_SESSION_COOKIE);
    expect(attributes.name.startsWith("__Host-")).toBe(true);
  });

  it("carries every attribute the requirement names", () => {
    const header = serializeSessionCookie(attributes, "opaque-secret");
    expect(header).toContain("__Host-mn_session=opaque-secret");
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
    expect(header).toContain("Path=/");
  });

  it("sets no Domain", () => {
    // A Domain attribute would widen the cookie to subdomains and would also
    // make the browser reject the __Host- prefix outright.
    expect(serializeSessionCookie(attributes, "x")).not.toContain("Domain");
  });

  it("is SameSite=Strict, not Lax", () => {
    // Lax would leave top-level navigations authenticated. There is no
    // cross-site entry point that needs to carry a session here, so the looser
    // mode would buy nothing.
    expect(attributes.sameSite).toBe("Strict");
  });
});

describe("the loopback exception", () => {
  const attributes = sessionCookieAttributes(loopback, 3600);

  it("uses a different name entirely", () => {
    // Two names rather than one name with different flags: a production
    // deployment that somehow issued the development cookie is immediately
    // visible in a request, instead of looking like an ordinary session with a
    // missing attribute.
    expect(attributes.name).toBe(DEVELOPMENT_SESSION_COOKIE);
    expect(attributes.name).not.toBe(PRODUCTION_SESSION_COOKIE);
  });

  it("is not Secure, or the browser would never send it over HTTP", () => {
    expect(attributes.secure).toBe(false);
    expect(serializeSessionCookie(attributes, "x")).not.toContain("Secure");
  });

  it("is still HttpOnly", () => {
    // The exception relaxes transport, not script access. A development cookie
    // readable from JavaScript would make every XSS a session theft, which is
    // not part of the trade.
    expect(attributes.httpOnly).toBe(true);
    expect(serializeSessionCookie(attributes, "x")).toContain("HttpOnly");
  });

  it("is still SameSite=Strict", () => {
    expect(attributes.sameSite).toBe("Strict");
  });
});

describe("which cookie an installation will honour", () => {
  it("production never accepts the development cookie", () => {
    // The assertion this whole file exists for. Accepting it would hand a
    // session to anyone who can set a cookie over plain HTTP.
    expect(acceptsCookieName("production", DEVELOPMENT_SESSION_COOKIE)).toBe(false);
    expect(acceptsCookieName("production", PRODUCTION_SESSION_COOKIE)).toBe(true);
  });

  it("loopback never accepts the production cookie", () => {
    // Symmetrical, and not merely tidy: a cookie left over from a production
    // origin must not authorize anything against a local installation.
    expect(acceptsCookieName("loopback-development", PRODUCTION_SESSION_COOKIE)).toBe(false);
    expect(acceptsCookieName("loopback-development", DEVELOPMENT_SESSION_COOKIE)).toBe(true);
  });

  it("a production request presenting the development cookie has no session at all", () => {
    const secret = readSessionSecret(
      requestWith(`${DEVELOPMENT_SESSION_COOKIE}=stolen-secret`),
      production,
    );
    // Not a rejected session: no session. There is nothing to reject.
    expect(secret).toBeNull();
  });

  it("a loopback request presenting the production cookie has no session at all", () => {
    expect(
      readSessionSecret(requestWith(`${PRODUCTION_SESSION_COOKIE}=leftover`), loopback),
    ).toBeNull();
  });

  it("reads the right cookie when both are present", () => {
    // A browser that has visited both a production and a local installation
    // can hold both. The server must pick its own and ignore the other.
    const both = `${PRODUCTION_SESSION_COOKIE}=prod-secret; ${DEVELOPMENT_SESSION_COOKIE}=dev-secret`;
    expect(readSessionSecret(requestWith(both), production)).toBe("prod-secret");
    expect(readSessionSecret(requestWith(both), loopback)).toBe("dev-secret");
  });
});

describe("cookie parsing", () => {
  it("handles the ordinary shape", () => {
    const cookies = parseCookies("a=1; b=2; c=3");
    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("c")).toBe("3");
  });

  it("keeps the first value when a name repeats", () => {
    // A repeated cookie name is a classic way to smuggle a second value past
    // a parser that keeps the last one. Taking the first is a fixed rule
    // rather than whichever the attacker appended.
    expect(parseCookies("s=first; s=second").get("s")).toBe("first");
  });

  it("ignores malformed pairs rather than guessing", () => {
    const cookies = parseCookies("=novalue; noequals; valid=yes");
    expect(cookies.get("valid")).toBe("yes");
    expect(cookies.size).toBe(1);
  });

  it("treats an empty value as no session", () => {
    expect(readSessionSecret(requestWith(`${PRODUCTION_SESSION_COOKIE}=`), production)).toBeNull();
  });

  it("survives an absent header", () => {
    expect(parseCookies(undefined).size).toBe(0);
    expect(readSessionSecret(requestWith(undefined), production)).toBeNull();
  });
});

describe("clearing", () => {
  it("uses the same name and attributes it was set with", () => {
    // A clear that differs in Path or name leaves the browser holding a cookie
    // the server will never honour again, and the owner looking at a sign-out
    // that did not take.
    const set = sessionCookieAttributes(production, 3600);
    const cleared = sessionCookieAttributes(production, 0);
    expect(cleared.name).toBe(set.name);
    expect(cleared.path).toBe(set.path);
    expect(cleared.secure).toBe(set.secure);
    expect(serializeSessionCookie(cleared, "")).toContain("Max-Age=0");
  });
});

describe("the name the configuration reports", () => {
  it("matches what the policy issues", () => {
    // Two sources for one string is how a rename gets applied to issuance and
    // not to acceptance.
    expect(sessionCookieName(production.cookieMode)).toBe(production.sessionCookieName);
    expect(sessionCookieName(loopback.cookieMode)).toBe(loopback.sessionCookieName);
  });
});
