import { readFileSync } from "node:fs";
import path from "node:path";
import type { Session } from "electron";
import { DESKTOP_APP_ORIGIN, DESKTOP_PROTOCOL_SCHEME } from "./ipc-contract.ts";
import { packagedWebDist } from "./paths.ts";
import {
  desktopDevUsesRemoteShell,
  isDevLoopbackServerOrigin,
  packagedPathForAppRequest,
  rewritePackagedShellForCustomProtocol,
  shellIndexPath,
  shouldServePackagedShell,
} from "./protocol.ts";

const interceptedSessions = new WeakSet<Session>();

export function localAssetHeaders(mime: string): Record<string, string> {
  return {
    "content-type": mime,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  };
}

function fileResponse(filePath: string, mime: string, rewriteOrigin: string | null): Response {
  if (
    rewriteOrigin !== null &&
    (mime.includes("html") || mime.includes("javascript") || mime.includes("css"))
  ) {
    const body = rewritePackagedShellForCustomProtocol(
      readFileSync(filePath, "utf8"),
      mime,
      rewriteOrigin,
    );
    return new Response(body, { headers: localAssetHeaders(mime) });
  }
  const body = new Uint8Array(readFileSync(filePath));
  return new Response(body, { headers: localAssetHeaders(mime) });
}

function packagedFileResponse(url: URL, dist: string, rewriteOrigin: string | null): Response {
  const relative = packagedPathForAppRequest(url) ?? shellIndexPath(url.pathname);
  const filePath = path.join(dist, relative.replace(/^\//, ""));
  try {
    return fileResponse(filePath, mimeFor(filePath), rewriteOrigin);
  } catch {
    try {
      return fileResponse(path.join(dist, "index.html"), "text/html; charset=utf-8", rewriteOrigin);
    } catch {
      return new Response("Not found", {
        status: 404,
        headers: localAssetHeaders("text/plain; charset=utf-8"),
      });
    }
  }
}

function mimeFor(filePath: string): string {
  if (filePath.endsWith(".wasm")) return "application/wasm";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

const localProtocolSessions = new WeakSet<Session>();

export function registerLocalProtocol(ses: Session): void {
  if (localProtocolSessions.has(ses)) {
    return;
  }
  localProtocolSessions.add(ses);
  const dist = packagedWebDist();
  ses.protocol.handle(DESKTOP_PROTOCOL_SCHEME, (request) => {
    return packagedFileResponse(new URL(request.url), dist, DESKTOP_APP_ORIGIN);
  });
}

export function registerOriginInterception(ses: Session, getActiveOrigin: () => URL | null): void {
  if (interceptedSessions.has(ses)) {
    return;
  }
  interceptedSessions.add(ses);
  const intercept = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const active = getActiveOrigin();
    if (
      desktopDevUsesRemoteShell() &&
      active !== null &&
      isDevLoopbackServerOrigin(active) &&
      url.origin === active.origin
    ) {
      return ses.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    if (!shouldServePackagedShell(url, active)) {
      return ses.fetch(request, { bypassCustomProtocolHandlers: true, redirect: "error" });
    }
    return packagedFileResponse(url, packagedWebDist(), null);
  };
  ses.protocol.handle("http", intercept);
  ses.protocol.handle("https", intercept);
}

export function onboardingUrl(): string {
  return `${DESKTOP_APP_ORIGIN}/`;
}
