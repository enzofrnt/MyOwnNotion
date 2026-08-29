import { clampSidebarWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "@myownnotion/client-core";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useState,
} from "react";
import { AppIcon } from "../../ui/icons.tsx";
import {
  Button,
  DrawerContent,
  DrawerDismiss,
  DrawerHeading,
  DrawerRoot,
  DrawerTrigger,
} from "../../ui/primitives/index.ts";

export type SidebarMode = "desktop" | "tablet" | "mobile";
export const SIDEBAR_MOTION_DURATION_MS = 220;

export function sidebarModeForWidth(width: number): SidebarMode {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function currentMode(): SidebarMode {
  return sidebarModeForWidth(typeof window === "undefined" ? 1280 : window.innerWidth);
}

export interface ResponsiveSidebarProps {
  readonly children: ReactNode;
  readonly closeControlRef?: Ref<HTMLButtonElement>;
  readonly mobileOpen: boolean;
  readonly restoreMobileFocusOnClose?: boolean;
  readonly open: boolean;
  readonly width: number;
  readonly onMobileOpenChange: (open: boolean) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onWidthChange: (width: number) => void;
}

export function ResponsiveSidebar({
  children,
  closeControlRef,
  mobileOpen,
  onMobileOpenChange,
  onOpenChange,
  onWidthChange,
  open,
  restoreMobileFocusOnClose = true,
  width,
}: ResponsiveSidebarProps) {
  const [mode, setMode] = useState<SidebarMode>(currentMode);
  const [resizeOrigin, setResizeOrigin] = useState<{ x: number; width: number } | null>(null);

  useEffect(() => {
    const update = (): void => setMode(currentMode());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const style = {
    "--workspace-sidebar-width": `${clampSidebarWidth(width)}px`,
  } as CSSProperties;

  if (mode === "mobile") {
    return (
      <div className="workspace-sidebar-slot" data-mode={mode} data-open={mobileOpen} style={style}>
        <DrawerRoot open={mobileOpen} setOpen={onMobileOpenChange}>
          <DrawerTrigger
            className="workspace-sidebar-trigger"
            data-testid="toggle-tree"
            aria-expanded={mobileOpen}
            aria-controls="workspace-navigation"
          >
            <AppIcon name="menu" />
            <span>Navigation</span>
          </DrawerTrigger>
          <DrawerContent
            id="workspace-navigation"
            className="workspace-sidebar-drawer"
            side="left"
            data-testid="workspace-navigation-drawer"
            autoFocusOnHide={restoreMobileFocusOnClose}
          >
            <DrawerHeading className="ui-visually-hidden">Navigation</DrawerHeading>
            <DrawerDismiss />
            {children}
          </DrawerContent>
        </DrawerRoot>
      </div>
    );
  }

  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (resizeOrigin === null) return;
    onWidthChange(resizeOrigin.width + event.clientX - resizeOrigin.x);
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (resizeOrigin === null) return;
    setResizeOrigin(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="workspace-sidebar-slot" data-mode={mode} data-open={open} style={style}>
      <aside
        id="workspace-navigation"
        className="workspace-sidebar-panel"
        aria-label="Navigation de l’espace de travail"
        aria-hidden={!open}
        data-open={open}
        inert={!open ? true : undefined}
      >
        <div className="workspace-sidebar-panel__content" tabIndex={open ? 0 : -1}>
          {children}
        </div>
        <Button
          ref={closeControlRef}
          className="workspace-sidebar-close"
          data-testid="close-sidebar"
          size="square"
          variant="ghost"
          aria-label="Masquer la barre latérale"
          title="Masquer la barre latérale"
          onClick={() => onOpenChange(false)}
        >
          <AppIcon name="panelClose" />
        </Button>
        <hr
          className="workspace-sidebar-resizer"
          data-testid="sidebar-resizer"
          aria-label="Redimensionner la barre latérale"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={clampSidebarWidth(width)}
          tabIndex={open ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") onWidthChange(width - 8);
            else if (event.key === "ArrowRight") onWidthChange(width + 8);
            else if (event.key === "Home") onWidthChange(MIN_SIDEBAR_WIDTH);
            else if (event.key === "End") onWidthChange(MAX_SIDEBAR_WIDTH);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizeOrigin({ x: event.clientX, width });
          }}
          onPointerMove={onResizePointerMove}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
      </aside>
    </div>
  );
}
