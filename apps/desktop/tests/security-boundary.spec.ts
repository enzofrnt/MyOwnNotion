import { describe, expect, it } from "vitest";
import { decideFrame, decideNavigation } from "../src/navigation-policy.ts";
import {
  isDevLoopbackServerOrigin,
  packagedPathForAppRequest,
  rewritePackagedShellForCustomProtocol,
  shouldServePackagedShell,
} from "../src/protocol.ts";

describe("desktop security boundary", () => {
  it("blocks unexpected navigations and frames", () => {
    const active = new URL("https://notes.example.org");
    expect(decideNavigation(new URL("https://evil.example"), active)).toBe("deny");
    expect(decideNavigation(new URL("myownnotion://app/"), null)).toBe("allow");
    expect(decideFrame(new URL("https://notes.example.org/v1/items"), active)).toBe("deny");
  });

  it("allows the local app protocol even though URL.origin is null", () => {
    expect(new URL("myownnotion://app/").origin).toBe("null");
    expect(decideNavigation(new URL("myownnotion://app/onboarding"), null)).toBe("allow");
  });

  it("never serves server JavaScript as the shell", () => {
    const origin = new URL("https://notes.example.org");
    expect(shouldServePackagedShell(new URL("https://notes.example.org/notes"), origin)).toBe(true);
    expect(shouldServePackagedShell(new URL("https://notes.example.org/v1/items"), origin)).toBe(
      false,
    );
    expect(shouldServePackagedShell(new URL("https://notes.example.org/health"), origin)).toBe(
      false,
    );
  });

  it("recognizes loopback dev server origins for remote shell loading", () => {
    expect(isDevLoopbackServerOrigin(new URL("https://localhost:8443"))).toBe(true);
    expect(isDevLoopbackServerOrigin(new URL("http://127.0.0.1:8080"))).toBe(true);
    expect(isDevLoopbackServerOrigin(new URL("https://notes.example.org"))).toBe(false);
    expect(isDevLoopbackServerOrigin(new URL("myownnotion://app"))).toBe(false);
  });

  it("maps custom-protocol asset hosts onto the packaged dist", () => {
    expect(packagedPathForAppRequest(new URL("myownnotion://app/"))).toBe("/index.html");
    expect(packagedPathForAppRequest(new URL("myownnotion://app/assets/index.js"))).toBe(
      "/assets/index.js",
    );
    expect(packagedPathForAppRequest(new URL("myownnotion://assets/index.js"))).toBe(
      "/assets/index.js",
    );
  });

  it("rewrites Vite absolute asset URLs onto the desktop app origin", () => {
    const html = rewritePackagedShellForCustomProtocol(
      '<head><link rel="stylesheet" href="/assets/index.css"><script type="module" src="/assets/index.js"></script></head>',
      "text/html",
      "myownnotion://app",
    );
    expect(html).not.toContain("<base ");
    expect(html).toContain('href="myownnotion://app/assets/index.css"');
    expect(html).toContain('src="myownnotion://app/assets/index.js"');
    const js = rewritePackagedShellForCustomProtocol(
      'import{x}from"/assets/chunk.js";import("/assets/app-router.js")',
      "text/javascript",
      "myownnotion://app",
    );
    expect(js).toBe(
      'import{x}from"myownnotion://app/assets/chunk.js";import("myownnotion://app/assets/app-router.js")',
    );
    expect(js.includes("myownnotion://app/myownnotion://")).toBe(false);
  });
});
