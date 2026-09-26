import { createContext, type ReactNode, type Ref, useContext } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export interface SidebarCollapseContextValue {
  readonly closeControlRef?: Ref<HTMLButtonElement>;
  readonly onClose: () => void;
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

/** Compact collapse control for the search row — only when the desktop sidebar mounts it. */
export function SidebarCollapseButton() {
  const collapse = useContext(SidebarCollapseContext);
  if (collapse === null) return null;
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
