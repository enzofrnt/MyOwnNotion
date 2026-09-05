/**
 * Owner-entered server URL policy (US1).
 *
 * Loopback HTTP is the supported local default. Any other clear-text HTTP
 * origin is allowed only as an explicit insecure channel — never presented as
 * safe. Non-http(s) schemes are refused.
 */

export type ServerUrlClassification = "local-http" | "https" | "insecure-http";

export type ServerUrlDecision =
  | { readonly ok: true; readonly origin: string; readonly classification: ServerUrlClassification }
  | { readonly ok: false; readonly reason: "empty" | "invalid" | "unsupported-scheme" };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

export function classifyServerUrl(url: URL): ServerUrlClassification {
  if (url.protocol === "https:") {
    return "https";
  }
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return "local-http";
  }
  return "insecure-http";
}

export function normalizeServerUrl(raw: string): ServerUrlDecision {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported-scheme" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "invalid" };
  }
  url.hash = "";
  url.search = "";
  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "";
  } else {
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    origin: url.origin,
    classification: classifyServerUrl(url),
  };
}

export function connectionStatusForClassification(
  classification: ServerUrlClassification,
): "compatible" | "insecure" {
  return classification === "insecure-http" ? "insecure" : "compatible";
}
