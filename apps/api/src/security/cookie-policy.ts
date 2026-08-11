/**
 * Session cookie issuance and acceptance (T045, feature 002).
 *
 * There are exactly two cookies, and they are two cookies rather than one
 * cookie with different attributes on purpose:
 *
 *   - `__Host-mn_session` — production. The `__Host-` prefix is enforced by
 *     the browser, not by us: it refuses the cookie unless it is `Secure`,
 *     `Path=/`, and has no `Domain`. That makes a downgrade to plain HTTP a
 *     browser-level impossibility rather than a server-side promise.
 *   - `mn_dev_session` — the named loopback exception. A separate name so the
 *     two can never be confused, and so a production deployment that somehow
 *     issued one would be immediately visible in a request rather than looking
 *     like an ordinary session with a missing flag.
 *
 * The predicate that matters is not "which cookie do we set" but **"which
 * cookie do we accept"**. A production installation must refuse
 * `mn_dev_session` outright: accepting it would mean an attacker who can set a
 * cookie over plain HTTP — trivially, on a shared network — gains a session
 * the production cookie's attributes were designed to prevent.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  DEVELOPMENT_SESSION_COOKIE,
  PRODUCTION_SESSION_COOKIE,
  type SecurityConfig,
  type SessionCookieMode,
} from "./security-config.ts";

export { DEVELOPMENT_SESSION_COOKIE, PRODUCTION_SESSION_COOKIE };

/**
 * The one cookie name this installation issues and accepts.
 *
 * Derived from the two names the configuration module already owns rather than
 * redeclared here: two sources for the same string is how a rename ends up
 * applied to issuance and not to acceptance, which would leave the server
 * setting a cookie it then refuses to read.
 */
export function sessionCookieName(mode: SessionCookieMode): string {
  return mode === "production" ? PRODUCTION_SESSION_COOKIE : DEVELOPMENT_SESSION_COOKIE;
}

export interface CookieAttributes {
  readonly name: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: "Strict";
  readonly path: "/";
  readonly maxAgeSeconds: number;
}

/**
 * The attributes for this installation's session cookie.
 *
 * `SameSite=Strict` rather than `Lax`: this is a single-owner workspace with no
 * cross-site entry points that need to carry a session, so the looser mode
 * would buy nothing and would leave top-level navigations authenticated.
 *
 * `HttpOnly` unconditionally, in both modes. The loopback exception relaxes
 * transport, not script access — a development cookie readable from JavaScript
 * would make every XSS in the app a session theft, which is not a trade the
 * exception is meant to include.
 */
export function sessionCookieAttributes(
  config: SecurityConfig,
  maxAgeSeconds: number,
): CookieAttributes {
  return {
    name: sessionCookieName(config.cookieMode),
    // Never `Secure` in loopback mode: the browser would refuse to send it
    // over plain HTTP and the exception would silently do nothing.
    secure: config.cookieMode === "production",
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAgeSeconds,
  };
}

/** Serializes attributes into a `Set-Cookie` value. */
export function serializeSessionCookie(attributes: CookieAttributes, value: string): string {
  const parts = [
    `${attributes.name}=${value}`,
    `Path=${attributes.path}`,
    `SameSite=${attributes.sameSite}`,
    `Max-Age=${attributes.maxAgeSeconds}`,
  ];
  if (attributes.httpOnly) {
    parts.push("HttpOnly");
  }
  if (attributes.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function setSessionCookie(
  reply: FastifyReply,
  config: SecurityConfig,
  value: string,
  maxAgeSeconds: number,
): void {
  reply.header(
    "set-cookie",
    serializeSessionCookie(sessionCookieAttributes(config, maxAgeSeconds), value),
  );
}

/** Clears the session cookie, using the same attributes it was set with. */
export function clearSessionCookie(reply: FastifyReply, config: SecurityConfig): void {
  reply.header("set-cookie", serializeSessionCookie(sessionCookieAttributes(config, 0), ""));
}

/** Parses a `Cookie` header into a map. Duplicates resolve to the first value. */
export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (header === undefined) {
    return cookies;
  }
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = pair.slice(0, index).trim();
    if (name.length === 0 || cookies.has(name)) {
      continue;
    }
    cookies.set(name, pair.slice(index + 1).trim());
  }
  return cookies;
}

/**
 * Reads the session secret this installation is willing to accept.
 *
 * Only the cookie for the configured mode is read. A production installation
 * presented with `mn_dev_session` sees nothing at all — not a rejected
 * session, no session. The reverse holds too: a loopback installation ignores
 * `__Host-mn_session`, so a cookie left over from a production origin cannot
 * authorize anything here.
 */
export function readSessionSecret(request: FastifyRequest, config: SecurityConfig): string | null {
  const cookies = parseCookies(request.headers.cookie);
  const value = cookies.get(sessionCookieName(config.cookieMode));
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Whether a cookie name would ever be honoured by this installation.
 *
 * Exported so the refusal is testable directly, without constructing a
 * request: "would production ever accept the development cookie?" is the
 * question, and it deserves an answer that does not depend on plumbing.
 */
export function acceptsCookieName(mode: SessionCookieMode, name: string): boolean {
  return name === sessionCookieName(mode);
}
