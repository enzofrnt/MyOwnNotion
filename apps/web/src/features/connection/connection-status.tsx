/**
 * Which server this is, and whether trusting it is safe (T066-T068, US5).
 *
 * Four questions an owner cannot answer by looking at the workspace: is the
 * server reachable, does it speak a version this client understands, is the
 * channel secure, and am I signed in. The default single-installation path
 * works without any of it — which is exactly why this matters at the moment
 * someone moves to a real deployment, where getting it wrong is a security
 * problem rather than an inconvenience.
 *
 * **The insecure-channel warning is stated plainly, not badged.** A subtle
 * indicator for "everything you write travels in clear text over a network you
 * do not control" is a decoration. It is worded as a warning and given the
 * error styling, and it is deliberately not dismissible.
 *
 * **Loopback over plain HTTP is not warned about.** The product ships that way
 * on purpose — `compose.yaml` publishes local HTTP by default and expects a
 * reverse proxy in front for anything public. Warning on the supported default
 * would teach the owner to ignore the warning that matters.
 */

import { useEffect, useState } from "react";
import type { ContentApi } from "../../services/content-api.ts";

/** The schema version this client was built against. */
export const EXPECTED_SCHEMA_VERSION = 1;

type Reachability =
  | { readonly kind: "checking" }
  | { readonly kind: "reachable"; readonly schemaVersion: number }
  | { readonly kind: "unreachable" };

/**
 * Whether an address is one the browser already treats as trustworthy.
 *
 * Matches the platform's own rule rather than inventing one: loopback is a
 * secure context even over plain HTTP, which is why the default deployment is
 * safe and a LAN address is not.
 */
export function isLocalAddress(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost")
  );
}

export function isInsecureRemote(location: { protocol: string; hostname: string }): boolean {
  return location.protocol !== "https:" && !isLocalAddress(location.hostname);
}

export function ConnectionStatus({ api }: { readonly api: ContentApi }) {
  const [reachability, setReachability] = useState<Reachability>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await api.health();
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setReachability({ kind: "unreachable" });
        return;
      }
      const value = result.value as { schemaVersion?: number };
      setReachability({ kind: "reachable", schemaVersion: value.schemaVersion ?? 0 });
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const insecure = isInsecureRemote(window.location);
  const mismatch =
    reachability.kind === "reachable" && reachability.schemaVersion !== EXPECTED_SCHEMA_VERSION;

  return (
    <section className="connection-status" aria-label="Connection">
      <p data-testid="connection-server" className="muted">
        Connected to <code>{window.location.host}</code>
      </p>

      <p data-testid="connection-reachability" data-state={reachability.kind} role="status">
        {reachability.kind === "checking"
          ? "Checking whether the server is reachable…"
          : reachability.kind === "reachable"
            ? "The server is reachable."
            : "The server is not reachable. Your work is kept on this device until it is."}
      </p>

      {insecure ? (
        // Not a badge. Everything written here travels in clear text over a
        // network the owner does not control, and that has to read as a
        // warning rather than as a status.
        <p className="status-banner" data-state="error" role="alert" data-testid="insecure-channel">
          <strong>This connection is not secure.</strong> You are using a plain HTTP address that is
          not on this machine, so anything you read or write can be seen and changed by anyone on
          the network in between. Put the server behind HTTPS before using it for real notes.
        </p>
      ) : null}

      {mismatch ? (
        // Said now rather than discovered later as an unrelated failure: a
        // version mismatch surfaces as strange, specific breakage otherwise —
        // one screen empty, one save refused — and an owner has no way to
        // connect that back to the cause.
        <p className="status-banner" data-state="error" role="alert" data-testid="version-mismatch">
          This server speaks schema version{" "}
          {reachability.kind === "reachable" ? reachability.schemaVersion : "?"} and this client
          expects {EXPECTED_SCHEMA_VERSION}. Update whichever is older before continuing; until
          then, saving may fail in ways that look unrelated.
        </p>
      ) : null}
    </section>
  );
}
