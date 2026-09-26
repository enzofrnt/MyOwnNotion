import { type ReactNode, useEffect, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import {
  ResponsiveSidebar,
  SIDEBAR_MOTION_DURATION_MS,
  type SidebarMode,
  sidebarModeForWidth,
} from "../navigation/responsive-sidebar.tsx";
import {
  type ChangeStreamStatus,
  WorkspaceChangeStreamContext,
} from "../sync/use-change-stream.ts";

export interface WorkspaceShellProps {
  readonly changeStream?: ChangeStreamStatus | null;
  readonly children: ReactNode;
  readonly header: ReactNode;
  readonly contentMode?: "bounded" | "page" | "graph";
  readonly mobileNavigationOpen: boolean;
  readonly navigation: ReactNode;
  readonly restoreMobileFocusOnClose?: boolean;
  readonly sidebarOpen: boolean;
  readonly sidebarWidth: number;
  readonly onMobileNavigationOpenChange: (open: boolean) => void;
  readonly onSidebarOpenChange: (open: boolean) => void;
  readonly onSidebarWidthChange: (width: number) => void;
}

function currentSidebarMode(): SidebarMode {
  return sidebarModeForWidth(typeof window === "undefined" ? 1280 : window.innerWidth);
}

export function WorkspaceShell({
  changeStream = null,
  children,
  contentMode = "bounded",
  header,
  mobileNavigationOpen,
  navigation,
  onMobileNavigationOpenChange,
  onSidebarOpenChange,
  onSidebarWidthChange,
  restoreMobileFocusOnClose = true,
  sidebarOpen,
  sidebarWidth,
}: WorkspaceShellProps) {
  const openControl = useRef<HTMLButtonElement | null>(null);
  const closeControl = useRef<HTMLButtonElement | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mode, setMode] = useState<SidebarMode>(currentSidebarMode);

  useEffect(() => {
    const update = (): void => setMode(currentSidebarMode());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(
    () => () => {
      if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    },
    [],
  );

  const navigationVisible = mode === "mobile" ? mobileNavigationOpen : sidebarOpen;

  const changeSidebarOpen = (open: boolean): void => {
    const focusOrigin = document.activeElement;
    const focusStartedOnControl =
      focusOrigin === openControl.current || focusOrigin === closeControl.current;
    onSidebarOpenChange(open);
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    if (!focusStartedOnControl) return;
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      // A later keyboard action may have moved focus into the document while
      // the rail animates. Do not pull it back to the toggle after that action.
      if (document.activeElement !== focusOrigin && document.activeElement !== document.body)
        return;
      (open ? closeControl : openControl).current?.focus();
    }, SIDEBAR_MOTION_DURATION_MS);
  };

  const openNavigation = (): void => {
    if (mode === "mobile") {
      onMobileNavigationOpenChange(true);
      return;
    }
    changeSidebarOpen(true);
  };

  return (
    <div className="workspace-shell" data-sidebar-open={sidebarOpen} data-testid="workspace-shell">
      <a className="workspace-skip-link" href="#workspace-main">
        Aller au contenu
      </a>
      <ResponsiveSidebar
        closeControlRef={closeControl}
        openControlRef={openControl}
        mobileOpen={mobileNavigationOpen}
        open={sidebarOpen}
        restoreMobileFocusOnClose={restoreMobileFocusOnClose}
        width={sidebarWidth}
        onMobileOpenChange={onMobileNavigationOpenChange}
        onOpenChange={changeSidebarOpen}
        onWidthChange={onSidebarWidthChange}
      >
        {navigation}
      </ResponsiveSidebar>
      <div className="workspace-stage">
        <div className="workspace-stage__header">
          {header}
          <Button
            ref={openControl}
            className="workspace-sidebar-desktop-trigger"
            data-testid="toggle-sidebar"
            data-visible={!navigationVisible || undefined}
            size="square"
            variant="ghost"
            aria-label="Afficher la barre latérale"
            aria-expanded={navigationVisible}
            aria-controls="workspace-navigation"
            onClick={openNavigation}
          >
            <AppIcon name="panelOpen" size="small" />
            <span className="ui-visually-hidden">Afficher la barre latérale</span>
          </Button>
        </div>
        <main
          id="workspace-main"
          className="workspace-main"
          data-content-mode={contentMode}
          tabIndex={-1}
          data-testid="workspace-main"
        >
          <WorkspaceChangeStreamContext.Provider value={changeStream}>
            <div className="workspace-reading-column">{children}</div>
          </WorkspaceChangeStreamContext.Provider>
        </main>
      </div>
    </div>
  );
}
