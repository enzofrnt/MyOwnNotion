import { DESKTOP_PROTOCOL_HOST, DESKTOP_PROTOCOL_SCHEME } from "./ipc-contract.ts";

/**
 * Which requests stay on the local packaged shell vs the configured server.
 *
 * The desktop never executes JavaScript from the server. API, health, and
 * realtime sockets pass through to the active origin; everything else is the
 * packaged web client.
 */

const API_PREFIXES = ["/v1/", "/health"];

export function isServerDataPath(pathname: string): boolean {
  if (pathname === "/health" || pathname.startsWith("/health/")) {
    return true;
  }
  return pathname === "/v1" || pathname.startsWith("/v1/");
}

export function shouldServePackagedShell(requestUrl: URL, activeOrigin: URL | null): boolean {
  if (activeOrigin === null) {
    return false;
  }
  if (requestUrl.origin !== activeOrigin.origin) {
    return false;
  }
  return !isServerDataPath(requestUrl.pathname);
}

/** Loopback dev servers where the renderer should load Vite HMR, not packaged dist. */
export function isDevLoopbackServerOrigin(origin: URL): boolean {
  if (origin.protocol !== "http:" && origin.protocol !== "https:") {
    return false;
  }
  const host = origin.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export function desktopDevUsesRemoteShell(): boolean {
  return process.env["MYOWNNOTION_DESKTOP_DEV"] === "1";
}

export function shellIndexPath(pathname: string): string {
  if (pathname === "/" || pathname === "") {
    return "/index.html";
  }
  const last = pathname.split("/").pop() ?? "";
  if (!last.includes(".")) {
    return "/index.html";
  }
  return pathname;
}

/** Map a `myownnotion:` request onto a path inside `apps/web/dist`. */
export function packagedPathForAppRequest(url: URL): string | null {
  if (url.protocol !== `${DESKTOP_PROTOCOL_SCHEME}:`) {
    return null;
  }
  if (url.hostname === DESKTOP_PROTOCOL_HOST || url.hostname === "") {
    return shellIndexPath(url.pathname);
  }
  return shellIndexPath(`/${url.hostname}${url.pathname}`);
}

/**
 * Vite emits root-absolute `/assets/…` URLs. Make them explicit on the desktop
 * origin so module resolution never depends on how Chromium serializes the
 * custom scheme's origin. No `<base>` is injected: the CSP forbids it.
 */
export function rewritePackagedShellForCustomProtocol(
  content: string,
  mime: string,
  origin: string,
): string {
  const assets = `${origin}/assets/`;
  if (mime.includes("html")) {
    return content
      .replaceAll('href="/assets/', `href="${assets}`)
      .replaceAll('src="/assets/', `src="${assets}`);
  }
  if (mime.includes("javascript") || mime.includes("css")) {
    return content
      .replaceAll('"/assets/', `"${assets}`)
      .replaceAll("'/assets/", `'${assets}`)
      .replaceAll("`/assets/", `\`${assets}`)
      .replaceAll("(/assets/", `(${assets}`)
      .replaceAll("url(/assets/", `url(${assets}`);
  }
  return content;
}

export { API_PREFIXES };
