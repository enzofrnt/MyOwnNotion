import { isDesktopAppUrl } from "./ipc-contract.ts";
import { isServerDataPath } from "./protocol.ts";

export type NavigationDecision = "allow" | "deny";

export function decideNavigation(target: URL, activeOrigin: URL | null): NavigationDecision {
  if (isDesktopAppUrl(target)) {
    return "allow";
  }
  if (
    activeOrigin !== null &&
    target.origin === activeOrigin.origin &&
    !isServerDataPath(target.pathname)
  ) {
    return "allow";
  }
  return "deny";
}

export function decideFrame(target: URL, activeOrigin: URL | null): NavigationDecision {
  if (
    activeOrigin !== null &&
    target.origin === activeOrigin.origin &&
    isServerDataPath(target.pathname)
  ) {
    return "deny";
  }
  return decideNavigation(target, activeOrigin) === "allow" && isDesktopAppUrl(target)
    ? "allow"
    : "deny";
}

export const DESKTOP_CSP = [
  "default-src 'self'",
  // Theme bootstrap in index.html (inline, before the module graph loads).
  "script-src 'self' 'wasm-unsafe-eval' 'sha256-VrFz/XCMpYpmyBn0gc6kWnsvYHZej4N9Z7buN1un7bM='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");
