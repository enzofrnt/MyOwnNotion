import { createContext, type ReactNode, type Ref, useContext } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export interface SidebarCollapseContextValue {
  readonly closeControlRef?: Ref<HTMLButtonElement>;
  readonly onClose: () => void;
  /** `drawer` dismisses the mobile overlay instead of collapsing the rail. */
  readonly variant?: "rail" | "drawer";
}

const SidebarCollapseContext = createContext<SidebarCollapseContextValue | null>(null);

export function SidebarCollapseProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: SidebarCollapseContextValue;
}) {
  return (
    <SidebarCollapseContext.Provider value={value}>{children}</SidebarCollapseContext.Provider>
  );
}

/** Leading control of the sidebar header: collapses the rail or closes the drawer. */
export function SidebarCollapseButton() {
  const collapse = useContext(SidebarCollapseContext);
  if (collapse === null) return null;
  if (collapse.variant === "drawer") {
    return (
      <Button
        className="workspace-sidebar-close"
        data-testid="close-mobile-nav"
        size="square"
        variant="ghost"
        aria-label="Fermer la navigation"
        title="Fermer la navigation"
        onClick={() => collapse.onClose()}
      >
        <AppIcon name="close" size="small" />
      </Button>
    );
  }
  return (
    <Button
      ref={collapse.closeControlRef}
      className="workspace-sidebar-close"
      data-testid="close-sidebar"
      size="square"
      variant="ghost"
      aria-label="Masquer la barre latérale"
      title="Masquer la barre latérale"
      onClick={() => collapse.onClose()}
    >
      <AppIcon name="panelClose" size="small" />
    </Button>
  );
}
