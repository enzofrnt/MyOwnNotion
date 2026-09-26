import {
  effectiveSidebarWidth,
  MIN_SIDEBAR_WIDTH,
  maxSidebarWidthForViewport,
} from "@myownnotion/client-core";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DrawerContent,
  DrawerDismiss,
  DrawerHeading,
  DrawerRoot,
} from "../../ui/primitives/index.ts";
import { type SidebarCollapseContextValue, SidebarCollapseProvider } from "./sidebar-collapse.tsx";

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

function currentViewportWidth(): number {
  return typeof window === "undefined" ? 1280 : window.innerWidth;
}

export interface ResponsiveSidebarProps {
  readonly children: ReactNode;
  readonly closeControlRef?: Ref<HTMLButtonElement>;
  /** Element that reopens the mobile drawer; Escape returns focus here. */
  readonly openControlRef?: RefObject<HTMLButtonElement | null>;
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
  openControlRef,
  mobileOpen,
  onMobileOpenChange,
  onOpenChange,
  onWidthChange,
  open,
  restoreMobileFocusOnClose = true,
  width,
}: ResponsiveSidebarProps) {
  const [mode, setMode] = useState<SidebarMode>(currentMode);
  const [viewportWidth, setViewportWidth] = useState(currentViewportWidth);
  const [resizeOrigin, setResizeOrigin] = useState<{ x: number; width: number } | null>(null);
  const previousMode = useRef(mode);

  useEffect(() => {
    const update = (): void => {
      const nextMode = currentMode();
      const nextWidth = currentViewportWidth();
      // Narrow viewports have no room for a permanent rail: close the sidebar
      // (and any open drawer) instead of swapping in a floating "Navigation"
      // reopen button. The stage header's panel-open control remains the only
      // way back in.
      if (previousMode.current !== "mobile" && nextMode === "mobile") {
        onOpenChange(false);
        onMobileOpenChange(false);
      }
      previousMode.current = nextMode;
      setMode(nextMode);
      setViewportWidth(nextWidth);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [onMobileOpenChange, onOpenChange]);

  const layoutWidth = effectiveSidebarWidth(width, viewportWidth);
  const viewportMax = maxSidebarWidthForViewport(viewportWidth);
  const style = {
    "--workspace-sidebar-width": `${layoutWidth}px`,
  } as CSSProperties;

  const commitWidth = (next: number): void => {
    onWidthChange(effectiveSidebarWidth(next, currentViewportWidth()));
  };

  const collapse = useMemo((): SidebarCollapseContextValue => {
    const value: SidebarCollapseContextValue = {
      onClose: () => onOpenChange(false),
    };
    if (closeControlRef !== undefined) {
      return { ...value, closeControlRef };
    }
    return value;
  }, [closeControlRef, onOpenChange]);

  if (mode === "mobile") {
    return (
      <div className="workspace-sidebar-slot" data-mode={mode} data-open={mobileOpen} style={style}>
        <DrawerRoot open={mobileOpen} setOpen={onMobileOpenChange}>
          <DrawerContent
            id="workspace-navigation"
            className="workspace-sidebar-drawer"
            side="left"
            data-testid="workspace-navigation-drawer"
            autoFocusOnHide={restoreMobileFocusOnClose}
            {...(openControlRef !== undefined ? { finalFocus: openControlRef } : {})}
          >
            <DrawerHeading className="ui-visually-hidden">Navigation</DrawerHeading>
            <DrawerDismiss data-testid="close-mobile-nav" />
            {children}
          </DrawerContent>
        </DrawerRoot>
      </div>
    );
  }

  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (resizeOrigin === null) return;
    commitWidth(resizeOrigin.width + event.clientX - resizeOrigin.x);
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (resizeOrigin === null) return;
    setResizeOrigin(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      className="workspace-sidebar-slot"
      data-mode={mode}
      data-open={open}
      data-resizing={resizeOrigin !== null || undefined}
      style={style}
    >
      <aside
        id="workspace-navigation"
        className="workspace-sidebar-panel"
        aria-label="Navigation de l’espace de travail"
        aria-hidden={!open}
        data-open={open}
        inert={!open ? true : undefined}
      >
        <div className="workspace-sidebar-panel__content" tabIndex={open ? 0 : -1}>
          <SidebarCollapseProvider value={collapse}>{children}</SidebarCollapseProvider>
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a vertical resize grip is not an <hr>; ARIA separator matches the control. */}
        <div
          className="workspace-sidebar-resizer"
          data-testid="sidebar-resizer"
          role="separator"
          aria-label="Redimensionner la barre latérale"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={viewportMax}
          aria-valuenow={layoutWidth}
          title="Glisser pour redimensionner la liste des pages"
          tabIndex={open ? 0 : -1}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") commitWidth(layoutWidth - 1);
            else if (event.key === "ArrowRight") commitWidth(layoutWidth + 1);
            else if (event.key === "Home") commitWidth(MIN_SIDEBAR_WIDTH);
            else if (event.key === "End") commitWidth(viewportMax);
            else if (event.key === "PageDown") commitWidth(layoutWidth - 16);
            else if (event.key === "PageUp") commitWidth(layoutWidth + 16);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizeOrigin({ x: event.clientX, width: layoutWidth });
          }}
          onPointerMove={onResizePointerMove}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
        />
      </aside>
    </div>
  );
}
