import { type KeyboardEvent, useEffect, useRef, type WheelEvent } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { ItemIcon, type ItemIconKind } from "../../ui/item-icon.tsx";

export function isCloseTabShortcut(event: {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}): boolean {
  return (
    event.key.toLocaleLowerCase("en") === "w" &&
    (event.ctrlKey || event.metaKey) &&
    event.altKey !== true
  );
}

export interface OpenTab {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemIconKind | "graph";
  readonly icon?: string | null;
}

export interface OpenTabsStripProps {
  readonly tabs: readonly OpenTab[];
  readonly activeId: string | null;
  readonly onActivate: (itemId: string) => void;
  readonly onClose: (itemId: string) => void;
}

function tabLabel(tab: OpenTab): string {
  return tab.name.trim() || "Sans titre";
}

/**
 * The strip of opened pages and folders at the top of the canvas (spec 022, US2).
 *
 * Tabs are navigation shortcuts, so the active one follows the URL rather than
 * owning it. The list scrolls horizontally instead of wrapping, the active tab
 * is scrolled into view when it changes, and arrow keys move focus between
 * tabs so the strip is one tab stop.
 */
export function OpenTabsStrip({ activeId, onActivate, onClose, tabs }: OpenTabsStripProps) {
  const list = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (activeId === null || !isCloseTabShortcut(event)) return;
      event.preventDefault();
      onClose(activeId);
    };
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
  }, [activeId, onClose]);

  useEffect(() => {
    // The active tab is often appended in the render that follows the route
    // change, so the strip must react to the list as well as to the id.
    if (activeId === null || !tabs.some((tab) => tab.id === activeId)) return;
    const active = [...(list.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find(
      (button) => button.dataset["tabId"] === activeId,
    );
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const buttons = [...(list.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowLeft") next = current <= 0 ? buttons.length - 1 : current - 1;
    else next = current >= buttons.length - 1 ? 0 : current + 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>): void => {
    // A mouse wheel only produces vertical deltas; translate them so the strip
    // can still be browsed without a trackpad.
    const element = list.current;
    if (element === null || event.deltaX !== 0 || event.deltaY === 0) return;
    if (element.scrollWidth <= element.clientWidth) return;
    element.scrollLeft += event.deltaY;
  };

  if (tabs.length === 0) return null;

  return (
    <div
      ref={list}
      className="open-tabs"
      role="tablist"
      aria-label="Éléments ouverts"
      aria-orientation="horizontal"
      data-testid="open-tabs"
      onKeyDown={onKeyDown}
      onWheel={onWheel}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = tabLabel(tab);
        return (
          <div
            key={tab.id}
            className="open-tab"
            data-active={active || undefined}
            data-testid="open-tab"
            data-tab-id={tab.id}
          >
            <button
              type="button"
              role="tab"
              className="open-tab__activate"
              aria-selected={active}
              tabIndex={active || (activeId === null && tab === tabs[0]) ? 0 : -1}
              title={label}
              data-tab-id={tab.id}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) onClose(tab.id);
              }}
            >
              {tab.kind === "graph" ? (
                <AppIcon name="graph" size="small" />
              ) : (
                <ItemIcon kind={tab.kind} icon={tab.icon ?? null} size="tree" />
              )}
              <span className="open-tab__label">{label}</span>
            </button>
            <button
              type="button"
              className="open-tab__close"
              aria-label={`Fermer l’onglet ${label}`}
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <AppIcon name="close" size="small" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
