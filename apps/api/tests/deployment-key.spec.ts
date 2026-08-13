/**
 * Deployment key loading and the loopback cookie exception (T016, feature 002).
 *
 * The key tests run against real files with real modes, not mocks: the
 * permission check is the point, and a mocked `statSync` would assert nothing
 * about what the filesystem actually allows.
 *
 * Every failure path must fail *closed*. The dangerous outcome is not an
 * error, it is a load that succeeds with material it should have refused —
 * the owner would then believe their data is protected by a key that anything
 * on the box can read.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkDeploymentKey,
  DEPLOYMENT_KEY_BYTES,
  DeploymentKeyUnavailableError,
  loadDeploymentKey,
} from "../src/security/deployment-key.ts";
import {
  acceptsCookieName,
  DEVELOPMENT_SESSION_COOKIE,
  isLoopbackHttpOrigin,
  loadSecurityConfig,
  PRODUCTION_SESSION_COOKIE,
  SecurityConfigError,
  sessionCookieAttributes,
} from "../src/security/security-config.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mn-key-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

let fixtureCounter = 0;

/**
 * Each fixture gets its own file: rewriting one already at 0400 fails with
 * EACCES, which would look like a loader bug rather than a test-setup one.
 */
function writeKey(contents: string, mode = 0o600, name?: string): string {
  fixtureCounter += 1;
  const target = path.join(root, name ?? `deployment-key-${fixtureCounter}`);
  writeFileSync(target, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(target, mode);
  return target;
}

const KEY_BYTES = randomBytes(DEPLOYMENT_KEY_BYTES);

describe("loading a valid key", () => {
  it("accepts base64 with a trailing newline", () => {
    // A hosting administrator writing the file by hand produces exactly this.
    const key = loadDeploymentKey(writeKey(`${KEY_BYTES.toString("base64")}\n`));
    expect(key.bytes).toEqual(new Uint8Array(KEY_BYTES));
  });

  it("accepts base64url and hex", () => {
    expect(loadDeploymentKey(writeKey(KEY_BYTES.toString("base64url"))).bytes).toEqual(
      new Uint8Array(KEY_BYTES),
    );
    expect(loadDeploymentKey(writeKey(KEY_BYTES.toString("hex"))).bytes).toEqual(
      new Uint8Array(KEY_BYTES),
    );
  });

  it("accepts mode 0400 as well as 0600", () => {
    expect(() => loadDeploymentKey(writeKey(KEY_BYTES.toString("base64"), 0o400))).not.toThrow();
    expect(() => loadDeploymentKey(writeKey(KEY_BYTES.toString("base64"), 0o600))).not.toThrow();
  });

  it("produces a stable fingerprint that is not the key", () => {
    const first = loadDeploymentKey(writeKey(KEY_BYTES.toString("base64")));
    const second = loadDeploymentKey(writeKey(KEY_BYTES.toString("base64"), 0o600, "copy"));
    expect(second.fingerprint).toBe(first.fingerprint);
    // The fingerprint is safe to record; it must not reveal the material.
    expect(first.fingerprint).not.toContain(KEY_BYTES.toString("base64"));
    expect(first.fingerprint).not.toContain(KEY_BYTES.toString("hex"));
    expect(first.fingerprint.length).toBeLessThan(32);
  });

  it("gives different keys different fingerprints", () => {
    const other = randomBytes(DEPLOYMENT_KEY_BYTES);
    expect(loadDeploymentKey(writeKey(other.toString("base64"))).fingerprint).not.toBe(
      loadDeploymentKey(writeKey(KEY_BYTES.toString("base64"), 0o600, "second")).fingerprint,
    );
  });
});

describe("failing closed", () => {
  it("refuses an unset path", () => {
    for (const value of [undefined, "", "   "]) {
      expect(() => loadDeploymentKey(value)).toThrow(DeploymentKeyUnavailableError);
      expect(checkDeploymentKey(value)).toEqual({ available: false, problem: "not-configured" });
    }
  });

  it("refuses a missing file", () => {
    expect(checkDeploymentKey(path.join(root, "absent"))).toEqual({
      available: false,
      problem: "missing",
    });
  });

  it("refuses a directory", () => {
    const directory = path.join(root, "a-directory");
    mkdirSync(directory);
    expect(checkDeploymentKey(directory)).toEqual({ available: false, problem: "not-a-file" });
  });

  it("refuses a group- or world-readable key", () => {
    // On a self-hosted box this is readable by every process, which defeats
    // the point of mounting it as a secret.
    for (const mode of [0o644, 0o640, 0o604, 0o666]) {
      const target = writeKey(KEY_BYTES.toString("base64"), mode, `key-${mode.toString(8)}`);
      expect(checkDeploymentKey(target), mode.toString(8)).toEqual({
        available: false,
        problem: "world-readable",
      });
    }
  });

  it("refuses an empty file", () => {
    expect(checkDeploymentKey(writeKey("\n"))).toEqual({ available: false, problem: "empty" });
  });

  it("refuses a key of the wrong length", () => {
    for (const length of [16, 31, 33, 64]) {
      const target = writeKey(randomBytes(length).toString("base64"), 0o600, `len-${length}`);
      expect(checkDeploymentKey(target), String(length)).toEqual({
        available: false,
        problem: "wrong-length",
      });
    }
  });

  it("refuses a passphrase rather than silently stretching it", () => {
    // Accepting this would provide far less entropy than the format promises,
    // while looking to the operator as though it worked.
    expect(checkDeploymentKey(writeKey("correct horse battery staple"))).toEqual({
      available: false,
      problem: "malformed",
    });
  });

  it("never puts key material in the error message", () => {
    const target = writeKey(randomBytes(16).toString("base64"));
    try {
      loadDeploymentKey(target);
      throw new Error("expected a failure");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(target);
      expect(message).not.toContain(KEY_BYTES.toString("base64"));
    }
  });

  it("reports only the problem category, never the path, to a status caller", () => {
    // The path is operator information and belongs in the server log.
    const status = checkDeploymentKey(path.join(root, "absent"));
    expect(JSON.stringify(status)).not.toContain(root);
  });

  it("follows a symlink but still enforces the target's mode", () => {
    const target = writeKey(KEY_BYTES.toString("base64"), 0o644, "permissive");
    const link = path.join(root, "link");
    symlinkSync(target, link);
    expect(checkDeploymentKey(link)).toEqual({ available: false, problem: "world-readable" });
  });
});

describe("session cookie policy", () => {
  const base = {
    MYOWNNOTION_PUBLIC_ORIGIN: "https://workspace.example",
    MYOWNNOTION_API_HOST: "127.0.0.1",
  };

  it("uses the __Host- cookie under HTTPS", () => {
    const config = loadSecurityConfig(base);
    expect(config.cookieMode).toBe("production");
    expect(config.sessionCookieName).toBe(PRODUCTION_SESSION_COOKIE);
    expect(sessionCookieAttributes(config)).toEqual({
      name: PRODUCTION_SESSION_COOKIE,
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
    });
  });

  it("refuses an HTTP origin without the named exception", () => {
    // There is no session policy that works here: `__Host-` requires Secure.
    expect(() =>
      loadSecurityConfig({ ...base, MYOWNNOTION_PUBLIC_ORIGIN: "http://workspace.example" }),
    ).toThrow(SecurityConfigError);
  });

  it("uses the separate development cookie on loopback HTTP with the exception", () => {
    const config = loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    });
    expect(config.cookieMode).toBe("loopback-development");
    expect(config.sessionCookieName).toBe(DEVELOPMENT_SESSION_COOKIE);
    // Never `Secure`, and never the `__Host-` prefix, which the browser would
    // reject without `Secure` anyway.
    expect(sessionCookieAttributes(config).secure).toBe(false);
    expect(config.sessionCookieName.startsWith("__Host-")).toBe(false);
  });

  it("refuses the exception on a non-loopback HTTP origin", () => {
    // The flag alone must never be enough: this would ship session cookies in
    // clear text over a network.
    expect(() =>
      loadSecurityConfig({
        MYOWNNOTION_PUBLIC_ORIGIN: "http://workspace.example",
        MYOWNNOTION_API_HOST: "127.0.0.1",
        MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      }),
    ).toThrow(/loopback HTTP public origin/);
  });

  it("allows the exception behind a published port, where the listener cannot be loopback", () => {
    // A container must listen on 0.0.0.0 to be reachable through its published
    // port at all. Refusing that combination made the exception unusable inside
    // the Compose stack, which silently dropped the entire security surface.
    // The loopback *origin* is what bounds the cookie's reach; confining the
    // published port to 127.0.0.1 is the deployment's job, and `compose.yaml`
    // does it under `pnpm compose:check`.
    const config = loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      MYOWNNOTION_API_HOST: "0.0.0.0",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    });

    expect(config.cookieMode).toBe("loopback-development");
    expect(config.sessionCookieName).toBe(DEVELOPMENT_SESSION_COOKIE);
    // The relaxation is about reachability only. The exception still never
    // yields the production cookie, and still never sets Secure.
    expect(sessionCookieAttributes(config).secure).toBe(false);
    expect(acceptsCookieName(config, PRODUCTION_SESSION_COOKIE)).toBe(false);
  });

  it("still refuses a non-loopback origin however the listener is bound", () => {
    // The origin check is the one that carries the guarantee, so relaxing the
    // listener must not open a network origin by way of `0.0.0.0`.
    expect(() =>
      loadSecurityConfig({
        MYOWNNOTION_PUBLIC_ORIGIN: "http://workspace.example",
        MYOWNNOTION_API_HOST: "0.0.0.0",
        MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
      }),
    ).toThrow(/loopback HTTP public origin/);
  });

  it("accepts exactly one cookie name per mode", () => {
    const production = loadSecurityConfig(base);
    expect(acceptsCookieName(production, PRODUCTION_SESSION_COOKIE)).toBe(true);
    // A production installation honouring the development cookie would accept
    // a session minted under the weaker policy.
    expect(acceptsCookieName(production, DEVELOPMENT_SESSION_COOKIE)).toBe(false);

    const development = loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "http://localhost:5173",
      MYOWNNOTION_API_HOST: "127.0.0.1",
      MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE: "1",
    });
    expect(acceptsCookieName(development, DEVELOPMENT_SESSION_COOKIE)).toBe(true);
    expect(acceptsCookieName(development, PRODUCTION_SESSION_COOKIE)).toBe(false);
  });

  it("recognises the loopback hostnames and rejects the rest", () => {
    for (const origin of ["http://127.0.0.1:5173", "http://localhost:3000", "http://[::1]:8080"]) {
      expect(isLoopbackHttpOrigin(new URL(origin)), origin).toBe(true);
    }
    for (const origin of [
      "https://127.0.0.1:5173",
      "http://192.168.1.10",
      "http://workspace.example",
      "http://127.0.0.1.example.com",
    ]) {
      expect(isLoopbackHttpOrigin(new URL(origin)), origin).toBe(false);
    }
  });
});

describe("configuration validation", () => {
  it("requires a public origin", () => {
    expect(() => loadSecurityConfig({})).toThrow(/MYOWNNOTION_PUBLIC_ORIGIN is required/);
  });

  it("refuses an origin carrying a path, query, or fragment", () => {
    for (const origin of [
      "https://workspace.example/app",
      "https://workspace.example/?a=1",
      "https://workspace.example/#x",
    ]) {
      expect(() => loadSecurityConfig({ MYOWNNOTION_PUBLIC_ORIGIN: origin }), origin).toThrow(
        SecurityConfigError,
      );
    }
  });

  it("refuses a non-http scheme", () => {
    expect(() => loadSecurityConfig({ MYOWNNOTION_PUBLIC_ORIGIN: "ftp://example.com" })).toThrow(
      SecurityConfigError,
    );
  });

  it("refuses a non-positive limit", () => {
    expect(() =>
      loadSecurityConfig({
        MYOWNNOTION_PUBLIC_ORIGIN: "https://workspace.example",
        MYOWNNOTION_MAX_BODY_BYTES: "0",
      }),
    ).toThrow(SecurityConfigError);
  });

  it("treats an empty trusted-proxy list as trusting no proxy", () => {
    const config = loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "https://workspace.example",
      MYOWNNOTION_TRUSTED_PROXY_CIDRS: "  ",
    });
    expect(config.trustedProxyCidrs).toEqual([]);
  });

  it("parses a trusted-proxy list", () => {
    const config = loadSecurityConfig({
      MYOWNNOTION_PUBLIC_ORIGIN: "https://workspace.example",
      MYOWNNOTION_TRUSTED_PROXY_CIDRS: "10.0.0.0/8, 192.168.0.0/16",
    });
    expect(config.trustedProxyCidrs).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });
});
