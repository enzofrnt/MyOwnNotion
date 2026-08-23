import type { ReactNode } from "react";
import { ResponsiveSidebar } from "../navigation/responsive-sidebar.tsx";

export interface WorkspaceShellProps {
  readonly children: ReactNode;
  readonly header: ReactNode;
  readonly mobileNavigationOpen: boolean;
  readonly navigation: ReactNode;
  readonly sidebarOpen: boolean;
  readonly sidebarWidth: number;
  readonly onMobileNavigationOpenChange: (open: boolean) => void;
  readonly onSidebarOpenChange: (open: boolean) => void;
  readonly onSidebarWidthChange: (width: number) => void;
}

export function WorkspaceShell({
  children,
  header,
  mobileNavigationOpen,
  navigation,
  onMobileNavigationOpenChange,
  onSidebarOpenChange,
  onSidebarWidthChange,
  sidebarOpen,
  sidebarWidth,
}: WorkspaceShellProps) {
  return (
    <div className="workspace-shell" data-testid="workspace-shell">
      <a className="workspace-skip-link" href="#workspace-main">
        Aller au contenu
      </a>
      <ResponsiveSidebar
        mobileOpen={mobileNavigationOpen}
        open={sidebarOpen}
        width={sidebarWidth}
        onMobileOpenChange={onMobileNavigationOpenChange}
        onOpenChange={onSidebarOpenChange}
        onWidthChange={onSidebarWidthChange}
      >
        {navigation}
      </ResponsiveSidebar>
      <div className="workspace-stage">
        {header}
        <main id="workspace-main" className="workspace-main" tabIndex={-1}>
          <div className="workspace-reading-column">{children}</div>
        </main>
      </div>
    </div>
  );
}
