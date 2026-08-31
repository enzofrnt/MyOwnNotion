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
import type { ProjectedItem } from "@myownnotion/client-core";
import type { SafeError, Uuid } from "@myownnotion/domain";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type NavigateOptions, useLocation, useNavigate } from "react-router-dom";
import { BootstrapPage, type BootstrapPageProps } from "./features/auth/bootstrap-page.tsx";
import { LoginPage } from "./features/auth/login-page.tsx";
import { BackupPanel } from "./features/backup/backup-panel.tsx";
import { ConnectionStatus } from "./features/connection/connection-status.tsx";
import {
  HierarchyExplorer,
  type HierarchyExplorerProps,
} from "./features/hierarchy/hierarchy-explorer.tsx";
import { NotFoundPage } from "./features/routing/not-found-page.tsx";
import { SecuritySettings } from "./features/security/security-settings.tsx";
import { type SettingsSection, SettingsShell } from "./features/settings/settings-shell.tsx";
import { WorkspaceManagementSettings } from "./features/settings/workspace-management-settings.tsx";
import { WorkspaceNavigationSettings } from "./features/settings/workspace-navigation-settings.tsx";
import {
  type ApplicationDestination,
  isProtectedDestination,
  notePath,
  pageSettingsPath,
  recognizeDestination,
  settingsPath,
} from "./routing/paths.ts";
import {
  loginPath,
  returnDestinationFromSearch,
  safeReturnDestination,
  setupPath,
  workspaceReturnDestinationFromState,
  workspaceReturnState,
} from "./routing/return-destination.ts";
import { ContentApi } from "./services/content-api.ts";
import { localContent } from "./services/local-content.ts";
import { SecurityApi } from "./services/security-api.ts";

declare const __MYOWNNOTION_E2E__: boolean;

if (typeof __MYOWNNOTION_E2E__ !== "undefined" && __MYOWNNOTION_E2E__) {
  Object.defineProperty(window, "__MYOWNNOTION_E2E_LOCAL_CONTENT__", {
    configurable: false,
    enumerable: false,
    value: localContent,
    writable: false,
  });
}

type Gate = "checking" | "bootstrap" | "login" | "workspace";
const BACKUP_STATUS_POLL_MS = 15 * 60 * 1000;

function settingsSectionFromDestination(
  destination: ApplicationDestination,
): SettingsSection | null {
  if (destination.kind === "page-settings") return "page-details";
  if (destination.kind !== "settings") return null;
  return destination.section === "storage-sync" ? "local-data" : destination.section;
}

function settingsDestination(section: SettingsSection, itemId: Uuid | null): string | null {
  if (section === "page-details") return itemId === null ? null : pageSettingsPath(itemId);
  if (section === "local-data") return settingsPath("storage-sync");
  return settingsPath(section);
}

function itemIdFromDestination(
  destination: ApplicationDestination,
  retainedItemId: Uuid | null,
): Uuid | null {
  if (destination.kind === "note" || destination.kind === "page-settings") {
    return destination.itemId;
  }
  if (destination.kind === "settings") return retainedItemId;
  return null;
}

function contentReturnFromState(state: unknown, itemId: Uuid): string | null {
  if (typeof state !== "object" || state === null || !("contentReturn" in state)) return null;
  const raw = (state as { readonly contentReturn?: unknown }).contentReturn;
  if (typeof raw !== "string") return null;
  const safe = safeReturnDestination(raw);
  if (safe === null) return null;
  const url = new URL(safe, "https://myownnotion.invalid");
  const destination = recognizeDestination(url.pathname);
  return destination.kind === "note" && destination.itemId === itemId ? safe : null;
}

export interface AppProps {
  /** Injected in tests; defaults to the same-origin client. */
  readonly api?: SecurityApi;
  /** Test seam for the retained workspace; production always uses the real explorer. */
  readonly hierarchy?: ComponentType<HierarchyExplorerProps>;
  /** Test seam for completing first-run setup without a browser authenticator. */
  readonly bootstrap?: ComponentType<BootstrapPageProps>;
  /** Test seam for deterministic History API refusal. */
  readonly navigate?: (path: string, options?: NavigateOptions) => void | Promise<void>;
}

export function App(props: AppProps = {}) {
  // Declared before any conditional return: a hook placed after one is a hook
  // that does not run on every render, which React refuses — and the symptom
  // is the whole application failing to mount, not a warning.
  //
  // One instance for the connection panel. It only issues a health check, so it
  // shares nothing with the content service and needs no coordination.
  const connectionApi = useMemo(() => new ContentApi(), []);
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const browserNavigate = useNavigate();
  const routeNavigate = props.navigate ?? browserNavigate;
  const destination = useMemo(() => recognizeDestination(location.pathname), [location.pathname]);

  const [api] = useState(() => props.api ?? new SecurityApi());
  const WorkspaceHierarchy = props.hierarchy ?? HierarchyExplorer;
  const SetupPage = props.bootstrap ?? BootstrapPage;
  const [gate, setGate] = useState<Gate>("checking");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [workspaceBackupStale, setWorkspaceBackupStale] = useState(false);
  const [activeItem, setActiveItem] = useState<ProjectedItem | null>(null);
  const [operationalProblem, setOperationalProblem] = useState<SafeError | null>(null);
  const [trashedItems, setTrashedItems] = useState<readonly ProjectedItem[]>([]);
  const [navigationProblem, setNavigationProblem] = useState<string | null>(null);
  const contentService = useMemo(() => localContent(), []);
  const workspaceReturn = useRef<{
    readonly focus: HTMLElement | null;
    readonly path: string;
    readonly scrollY: number;
  } | null>(null);
  const settingsSection = settingsSectionFromDestination(destination);
  const workspaceVisible = destination.kind === "notes" || destination.kind === "note";
  const protectedLayoutMounted = isProtectedDestination(destination);
  const routedItemId = itemIdFromDestination(destination, activeItem?.id ?? null);

  const navigateSafely = useCallback(
    (path: string, options?: NavigateOptions): void => {
      const reportRefusal = (): void => {
        setNavigationProblem(
          "Le navigateur a refusé ce changement d’adresse. Le contenu actuel reste ouvert.",
        );
      };
      try {
        const result = routeNavigate(path, options);
        if (result instanceof Promise) {
          void result.then(() => setNavigationProblem(null)).catch(reportRefusal);
          return;
        }
        setNavigationProblem(null);
      } catch {
        reportRefusal();
      }
    },
    [routeNavigate],
  );

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
    if (gate === "checking") return;

    if ("canonicalPath" in destination && destination.canonicalPath !== location.pathname) {
      navigateSafely(`${destination.canonicalPath}${location.search}`, { replace: true });
      return;
    }

    const requestedPath = isProtectedDestination(destination)
      ? safeReturnDestination(`${location.pathname}${location.search}`)
      : null;

    if (gate === "bootstrap") {
      if (destination.kind !== "setup") {
        navigateSafely(setupPath(requestedPath), { replace: true });
      }
      return;
    }
    if (gate === "login") {
      if (destination.kind !== "login") {
        navigateSafely(loginPath(requestedPath), { replace: true });
      }
      return;
    }

    if (destination.kind === "root") {
      navigateSafely("/notes", { replace: true });
      return;
    }
    if (destination.kind === "settings-root") {
      navigateSafely(settingsPath("security"), { replace: true });
      return;
    }
    if (destination.kind === "setup" || destination.kind === "login") {
      navigateSafely(returnDestinationFromSearch(location.search) ?? "/notes", { replace: true });
    }
  }, [destination, gate, location.pathname, location.search, navigateSafely]);

  useEffect(() => {
    if (gate !== "workspace" || !workspaceVisible) {
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
  }, [gate, loadBackupStatus, workspaceVisible]);

  const onSignedIn = useCallback(() => {
    void resolveGate();
  }, [resolveGate]);

  const onSignedOut = useCallback(() => {
    setSessionId(null);
    workspaceReturn.current = null;
    setGate("login");
  }, []);
  const pageOperationCsrfToken = useCallback(() => api.csrfTokenForSameOriginWrite(), [api]);

  const openSettings = useCallback(
    (section: SettingsSection) => {
      const path =
        safeReturnDestination(`${location.pathname}${location.search}`) ??
        (activeItem === null ? "/notes" : notePath(activeItem.id));
      const target = settingsDestination(section, activeItem?.id ?? null);
      if (target === null) return;
      workspaceReturn.current = {
        focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        path,
        scrollY: window.scrollY,
      };
      navigateSafely(target, { state: workspaceReturnState(path, window.scrollY) });
    },
    [activeItem, location.pathname, location.search, navigateSafely],
  );

  const changeSettingsSection = useCallback(
    (section: SettingsSection) => {
      const target = settingsDestination(section, activeItem?.id ?? routedItemId);
      if (target !== null) navigateSafely(target, { state: location.state });
    },
    [activeItem?.id, location.state, navigateSafely, routedItemId],
  );

  const returnToWorkspace = useCallback(() => {
    const remembered =
      workspaceReturnDestinationFromState(location.state) ?? workspaceReturn.current;
    navigateSafely(remembered?.path ?? "/notes");
  }, [location.state, navigateSafely]);

  const openItem = useCallback(
    (itemId: Uuid | null, options?: { readonly replace?: boolean }) => {
      const currentLocation = locationRef.current;
      let target = itemId === null ? "/notes" : notePath(itemId);
      if (itemId !== null && options?.replace === true) {
        target = contentReturnFromState(currentLocation.state, itemId) ?? target;
      }
      const currentPath = safeReturnDestination(
        `${currentLocation.pathname}${currentLocation.search}`,
      );
      navigateSafely(target, {
        ...(options?.replace === undefined ? {} : { replace: options.replace }),
        ...(currentPath === null ? {} : { state: { contentReturn: currentPath } }),
      });
    },
    [navigateSafely],
  );

  useLayoutEffect(() => {
    if (gate !== "workspace") return;
    if (!workspaceVisible) {
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    const destination = workspaceReturn.current;
    if (destination === null) return;
    window.scrollTo({ top: destination.scrollY, left: 0 });
    destination.focus?.focus({ preventScroll: true });
    workspaceReturn.current = null;
  }, [gate, workspaceVisible]);

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
        <SetupPage api={api} onReady={onSignedIn} />
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

  return (
    <>
      {protectedLayoutMounted ? (
        <div
          className="app-shell app-shell--workspace"
          hidden={!workspaceVisible}
          data-testid="workspace-surface"
        >
          <WorkspaceHierarchy
            active={workspaceVisible}
            backupStale={workspaceBackupStale}
            selectedItemId={routedItemId}
            pageOperationCsrfToken={pageOperationCsrfToken}
            onActiveItemChange={setActiveItem}
            onOpenBackups={() => openSettings("backups")}
            onOpenDiagnostics={() => openSettings("local-data")}
            onOpenSettings={() => openSettings("security")}
            onOpenItem={openItem}
            onProblemChange={setOperationalProblem}
            onTrashedItemsChange={setTrashedItems}
          />
        </div>
      ) : null}

      {navigationProblem === null ? null : (
        <p role="alert" data-testid="route-navigation-error">
          {navigationProblem}
        </p>
      )}

      {settingsSection === null ? null : (
        <SettingsShell
          activeSection={settingsSection}
          onBack={returnToWorkspace}
          onSectionChange={changeSettingsSection}
        >
          {settingsSection === "security" ? (
            <>
              {/* Trust information belongs to the security destination, not
                  alongside the owner's current note. */}
              <ConnectionStatus api={connectionApi} />
              <SecuritySettings api={api} currentSessionId={sessionId} onSignedOut={onSignedOut} />
            </>
          ) : settingsSection === "backups" ? (
            <BackupPanel load={loadBackupStatus} runRehearsal={runBackupRehearsal} />
          ) : settingsSection === "navigation" ? (
            <WorkspaceNavigationSettings db={contentService.db} />
          ) : (
            <WorkspaceManagementSettings
              activeItem={activeItem}
              section={settingsSection}
              service={contentService}
              problem={operationalProblem}
              trashedItems={trashedItems}
            />
          )}
        </SettingsShell>
      )}

      {destination.kind === "not-found" ? (
        <NotFoundPage onReturn={() => navigateSafely("/notes")} />
      ) : null}
    </>
  );
}
