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
import { FR_COPY } from "../../ui/copy/fr.ts";
import { AsyncState } from "../../ui/primitives/async-state.tsx";

/** The schema version this client was built against. */
export const EXPECTED_SCHEMA_VERSION = 1;

export type DesktopConnectionKind =
  | "compatible"
  | "read-only"
  | "incompatible"
  | "unreachable"
  | "insecure";

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

export function ConnectionStatus({
  api,
  hostLabel,
  desktopStatus,
}: {
  readonly api: ContentApi;
  readonly hostLabel?: string;
  readonly desktopStatus?: DesktopConnectionKind;
}) {
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

  const insecure = desktopStatus === "insecure" || isInsecureRemote(window.location);
  const mismatch =
    reachability.kind === "reachable" && reachability.schemaVersion !== EXPECTED_SCHEMA_VERSION;
  const shownHost = hostLabel ?? window.location.host;

  return (
    <section className="connection-status" aria-label={FR_COPY.connection.label}>
      <p data-testid="connection-server" className="muted">
        {FR_COPY.connection.connectedTo} <code>{shownHost}</code>
      </p>

      <p data-testid="connection-reachability" data-state={reachability.kind} role="status">
        {reachability.kind === "checking"
          ? FR_COPY.connection.checking
          : reachability.kind === "reachable"
            ? FR_COPY.connection.reachable
            : FR_COPY.connection.unreachable}
      </p>

      {desktopStatus === "read-only" ||
      desktopStatus === "incompatible" ||
      desktopStatus === "unreachable" ? (
        <AsyncState
          compact
          kind="error"
          testId={`desktop-connection-${desktopStatus}`}
          title={FR_COPY.desktop.status[desktopStatus]}
        />
      ) : null}

      {insecure ? (
        // Not a badge. Everything written here travels in clear text over a
        // network the owner does not control, and that has to read as a
        // warning rather than as a status.
        <AsyncState
          compact
          kind="error"
          testId="insecure-channel"
          title={FR_COPY.connection.insecureTitle}
          description={FR_COPY.connection.insecureDescription}
        />
      ) : null}

      {mismatch ? (
        // Said now rather than discovered later as an unrelated failure: a
        // version mismatch surfaces as strange, specific breakage otherwise —
        // one screen empty, one save refused — and an owner has no way to
        // connect that back to the cause.
        <AsyncState
          compact
          kind="error"
          testId="version-mismatch"
          title={FR_COPY.connection.versionMismatchTitle}
          description={FR_COPY.connection.versionMismatch(
            reachability.kind === "reachable" ? reachability.schemaVersion : "?",
            EXPECTED_SCHEMA_VERSION,
          )}
        />
      ) : null}
    </section>
  );
}
