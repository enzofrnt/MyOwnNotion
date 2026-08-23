/**
 * Application shell (T018, extended by T033 and T047).
 *
 * Three states, resolved once on load and then driven by events:
 *
 *   - no owner yet → first-run setup;
 *   - an owner, but no session in this browser → sign in;
 *   - a session → the workspace.
 *
 * Each is a hard swap rather than an overlay. An installation with no owner
 * has nothing to show behind a modal, and rendering the workspace underneath a
 * sign-in prompt would suggest the content is already available to whoever is
 * looking at the screen.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BootstrapPage } from "./features/auth/bootstrap-page.tsx";
import { LoginPage } from "./features/auth/login-page.tsx";
import { BackupPanel } from "./features/backup/backup-panel.tsx";
import { ConnectionStatus } from "./features/connection/connection-status.tsx";
import { HierarchyExplorer } from "./features/hierarchy/hierarchy-explorer.tsx";
import { SecuritySettings } from "./features/security/security-settings.tsx";
import { ContentApi } from "./services/content-api.ts";
import { SecurityApi } from "./services/security-api.ts";

type Gate = "checking" | "bootstrap" | "login" | "workspace";
type WorkspaceView = "workspace" | "security" | "backups";
const BACKUP_STATUS_POLL_MS = 15 * 60 * 1000;

export interface AppProps {
  /** Injected in tests; defaults to the same-origin client. */
  readonly api?: SecurityApi;
}

export function App(props: AppProps = {}) {
  // Declared before any conditional return: a hook placed after one is a hook
  // that does not run on every render, which React refuses — and the symptom
  // is the whole application failing to mount, not a warning.
  //
  // One instance for the connection panel. It only issues a health check, so it
  // shares nothing with the content service and needs no coordination.
  const connectionApi = useMemo(() => new ContentApi(), []);

  const [api] = useState(() => props.api ?? new SecurityApi());
  const [gate, setGate] = useState<Gate>("checking");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("workspace");
  const [workspaceBackupStale, setWorkspaceBackupStale] = useState(false);

  const loadBackupStatus = useCallback(async () => {
    const result = await api.backupStatus();
    if (!result.ok) {
      throw new Error(result.problem.code);
    }
    return result.value;
  }, [api]);

  const runBackupRehearsal = useCallback(async () => {
    const result = await api.runBackupRehearsal();
    if (!result.ok) {
      throw new Error(result.problem.code);
    }
  }, [api]);

  /**
   * Decides which of the three states this browser is in.
   *
   * The session is read after the status, not instead of it: an installation
   * with no owner has no session to look for, and asking would produce a
   * refusal that says nothing useful.
   */
  const resolveGate = useCallback(async (): Promise<void> => {
    const status = await api.status();
    // An unreachable or unreadable status is not treated as "no owner": that
    // would put a live installation back on the first-run page.
    if (status.ok && status.value.ownerCount === 0) {
      setGate("bootstrap");
      return;
    }
    const session = await api.currentSession();
    if (session.ok) {
      setSessionId(session.value.session.sessionId);
      setGate("workspace");
      return;
    }
    // **An unreachable server is not a refusal.** This application is meant to
    // keep working offline, and a browser that is merely disconnected still
    // holds its session cookie — sending it to a sign-in page it cannot
    // complete would lock the owner out of their own local content for as long
    // as the network is down. Only a server that answered, and refused, means
    // there is no session.
    //
    // Nothing is lost by continuing: authority is checked server-side on every
    // request, so an offline browser can read what it already has and can
    // change nothing that reaches the server.
    if (session.problem.code === "service_unavailable") {
      setGate("workspace");
      return;
    }
    setSessionId(null);
    setGate("login");
  }, [api]);

  useEffect(() => {
    void resolveGate();
  }, [resolveGate]);

  useEffect(() => {
    if (gate !== "workspace" || view !== "workspace") {
      return;
    }
    let cancelled = false;
    const refresh = () =>
      loadBackupStatus()
        .then((status) => {
          if (!cancelled) {
            setWorkspaceBackupStale(status.stale);
          }
        })
        .catch(() => {
          // An unavailable status is not evidence that a backup is stale. The
          // backup screen reports that uncertainty explicitly when opened.
        });
    void refresh();
    // SC-007 promises the warning within an hour of crossing the threshold,
    // including when the owner leaves one workspace tab open all day. Fifteen
    // minutes gives that guarantee without turning status into noisy traffic.
    const timer = window.setInterval(() => void refresh(), BACKUP_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gate, loadBackupStatus, view]);

  const onSignedIn = useCallback(() => {
    void resolveGate();
  }, [resolveGate]);

  const onSignedOut = useCallback(() => {
    setSessionId(null);
    setView("workspace");
    setGate("login");
  }, []);
  const pageOperationCsrfToken = useCallback(() => api.csrfTokenForSameOriginWrite(), [api]);

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
        <BootstrapPage api={api} onReady={onSignedIn} />
      </div>
    );
  }

  if (gate === "login") {
    return (
      <div className="app-shell">
        <LoginPage api={api} onSignedIn={onSignedIn} />
      </div>
    );
  }

  if (view === "workspace") {
    return (
      <div className="app-shell app-shell--workspace">
        <HierarchyExplorer
          backupStale={workspaceBackupStale}
          pageOperationCsrfToken={pageOperationCsrfToken}
          onOpenBackups={() => setView("backups")}
          onOpenSettings={() => setView("security")}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>MyOwnNotion</h1>
        <p className="app-subtitle">
          {view === "security" ? "Réglages et sécurité" : "Sauvegardes"}
        </p>
        <button
          type="button"
          className="link"
          onClick={() => setView("workspace")}
          data-testid="back-to-workspace"
        >
          Retour à l’espace de travail
        </button>
      </header>
      <main className="app-main">
        {view === "security" ? (
          <>
            {/* On the security screen rather than in the workspace chrome: an
                owner checks who they are talking to when they are thinking
                about trust, and a permanent banner in the sidebar becomes
                furniture nobody reads. The insecure-channel warning inside it
                is the exception — it is an alert wherever it appears. */}
            <ConnectionStatus api={connectionApi} />
            <SecuritySettings api={api} currentSessionId={sessionId} onSignedOut={onSignedOut} />
          </>
        ) : (
          <BackupPanel load={loadBackupStatus} runRehearsal={runBackupRehearsal} />
        )}
      </main>
    </div>
  );
}
