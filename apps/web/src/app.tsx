/**
 * Application shell (T018, extended by T033): single development workspace
 * with the hierarchy explorer as its primary surface, gated on an owner
 * existing.
 *
 * The gate is deliberately a hard swap rather than an overlay. An installation
 * with no owner has nothing to show behind a modal, and rendering the
 * workspace underneath would suggest content exists that the security layer
 * has not yet been asked to protect.
 */
import { useCallback, useEffect, useState } from "react";
import { BootstrapPage } from "./features/auth/bootstrap-page.tsx";
import { HierarchyExplorer } from "./features/hierarchy/hierarchy-explorer.tsx";
import { SecurityApi } from "./services/security-api.ts";

type Gate = "checking" | "bootstrap" | "workspace";

export interface AppProps {
  /** Injected in tests; defaults to the same-origin client. */
  readonly api?: SecurityApi;
}

export function App(props: AppProps = {}) {
  const [gate, setGate] = useState<Gate>("checking");

  useEffect(() => {
    const api = props.api ?? new SecurityApi();
    let cancelled = false;
    void (async () => {
      const result = await api.status();
      if (cancelled) {
        return;
      }
      // An unreachable or unreadable status is not treated as "no owner": that
      // would put a live installation back on the first-run page. The
      // bootstrap page itself reports the outage, and the API refuses a claim
      // on an installation that already has an owner regardless.
      setGate(result.ok && result.value.ownerCount === 0 ? "bootstrap" : "workspace");
    })();
    return () => {
      cancelled = true;
    };
  }, [props.api]);

  const onReady = useCallback(() => setGate("workspace"), []);

  if (gate === "checking") {
    return (
      <div className="app-shell">
        <p role="status" data-testid="app-checking">
          Checking this installation…
        </p>
      </div>
    );
  }

  if (gate === "bootstrap") {
    return (
      <div className="app-shell">
        <BootstrapPage {...(props.api ? { api: props.api } : {})} onReady={onReady} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>MyOwnNotion</h1>
        <p className="app-subtitle">Canonical content workspace</p>
      </header>
      <main className="app-main">
        <HierarchyExplorer />
      </main>
    </div>
  );
}
