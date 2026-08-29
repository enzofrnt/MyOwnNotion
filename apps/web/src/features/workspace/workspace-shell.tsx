import { type ReactNode, useEffect, useRef } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";
import {
  ResponsiveSidebar,
  SIDEBAR_MOTION_DURATION_MS,
} from "../navigation/responsive-sidebar.tsx";

export interface WorkspaceShellProps {
  readonly children: ReactNode;
  readonly header: ReactNode;
  readonly contentMode?: "bounded" | "page";
  readonly mobileNavigationOpen: boolean;
  readonly navigation: ReactNode;
  readonly restoreMobileFocusOnClose?: boolean;
  readonly sidebarOpen: boolean;
  readonly sidebarWidth: number;
  readonly onMobileNavigationOpenChange: (open: boolean) => void;
  readonly onSidebarOpenChange: (open: boolean) => void;
  readonly onSidebarWidthChange: (width: number) => void;
}

export function WorkspaceShell({
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

  useEffect(
    () => () => {
      if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    },
    [],
  );

  const changeSidebarOpen = (open: boolean): void => {
    onSidebarOpenChange(open);
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      (open ? closeControl : openControl).current?.focus();
    }, SIDEBAR_MOTION_DURATION_MS);
  };

  return (
    <div className="workspace-shell" data-sidebar-open={sidebarOpen} data-testid="workspace-shell">
      <a className="workspace-skip-link" href="#workspace-main">
        Aller au contenu
      </a>
      <ResponsiveSidebar
        closeControlRef={closeControl}
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
            data-visible={!sidebarOpen || undefined}
            size="square"
            variant="ghost"
            aria-label="Afficher la barre latérale"
            aria-expanded={sidebarOpen}
            aria-controls="workspace-navigation"
            onClick={() => changeSidebarOpen(true)}
          >
            <AppIcon name="panelOpen" />
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
          <div className="workspace-reading-column">{children}</div>
        </main>
      </div>
    </div>
  );
}
