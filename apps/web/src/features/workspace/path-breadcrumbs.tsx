import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { ItemIcon, type ItemIconKind } from "../../ui/item-icon.tsx";
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/index.ts";
import { type BreadcrumbLayout, selectVisibleCrumbs } from "./breadcrumb-layout.ts";

export interface PathCrumb {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemIconKind;
  readonly icon?: string | null;
}

export interface PathBreadcrumbsProps {
  /** Root first, current item last. */
  readonly path: readonly PathCrumb[];
  readonly onOpen: (itemId: string) => void;
}

const HIDDEN_MENU_LABEL = "Afficher les emplacements intermédiaires";

function crumbLabel(crumb: PathCrumb): string {
  return crumb.name.trim() || "Sans titre";
}

function Separator() {
  return (
    <span className="workspace-path__separator" aria-hidden="true">
      <AppIcon name="chevronRight" size="small" />
    </span>
  );
}

/**
 * The location line above a page's emoji (spec 022, US1).
 *
 * The full path is rendered once, invisibly, so each segment can be measured;
 * the visible list then keeps the current item, its parent and the root and
 * folds the rest into one "…" menu. Measurement reacts to resizes and to
 * renames, and does nothing in environments without layout (SSR, jsdom).
 */
export function PathBreadcrumbs({ onOpen, path }: PathBreadcrumbsProps) {
  const container = useRef<HTMLElement | null>(null);
  const measure = useRef<HTMLOListElement | null>(null);
  const [layout, setLayout] = useState<BreadcrumbLayout | null>(null);

  // Re-measure on every path change: a rename widens or narrows a segment.
  useLayoutEffect(() => {
    const nav = container.current;
    const list = measure.current;
    if (nav === null || list === null || path.length === 0) return;
    const compute = (): void => {
      const items = [...list.querySelectorAll<HTMLElement>("[data-measure='crumb']")];
      const separator = list.querySelector<HTMLElement>("[data-measure='separator']");
      const ellipsis = list.querySelector<HTMLElement>("[data-measure='ellipsis']");
      const widths = items.map((item) => item.getBoundingClientRect().width);
      const available = nav.getBoundingClientRect().width;
      if (available === 0 || widths.every((width) => width === 0)) {
        setLayout(null);
        return;
      }
      const next = selectVisibleCrumbs({
        widths,
        separatorWidth: separator?.getBoundingClientRect().width ?? 0,
        ellipsisWidth: ellipsis?.getBoundingClientRect().width ?? 0,
        available,
      });
      setLayout((current) =>
        current !== null &&
        current.visible.length === next.visible.length &&
        current.visible.every((index, position) => index === next.visible[position])
          ? current
          : next,
      );
    };
    compute();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => compute());
    observer.observe(nav);
    return () => observer.disconnect();
  }, [path]);

  const resolved = useMemo<BreadcrumbLayout>(() => {
    if (layout === null || layout.visible.length + layout.hidden.length !== path.length) {
      return { visible: path.map((_, index) => index), hidden: [] };
    }
    return layout;
  }, [layout, path]);

  if (path.length === 0) return null;
  const lastIndex = path.length - 1;
  const hiddenSet = new Set(resolved.hidden);
  const hiddenCrumbs = resolved.hidden.map((index) => path[index] as PathCrumb);
  // One slot per visible crumb plus one "…" slot standing where the hidden
  // block starts; separators go between consecutive slots.
  type Slot =
    | { readonly kind: "crumb"; readonly crumb: PathCrumb; readonly index: number }
    | { readonly kind: "folded" };
  const slots = path.flatMap((crumb, index): Slot[] => {
    if (!hiddenSet.has(index)) return [{ kind: "crumb", crumb, index }];
    return index === resolved.hidden[0] ? [{ kind: "folded" }] : [];
  });

  const renderCrumb = (crumb: PathCrumb, index: number) => {
    const current = index === lastIndex;
    return (
      <li
        className="workspace-path__crumb"
        data-current={current || undefined}
        aria-current={current ? "page" : undefined}
      >
        {current ? (
          <span className="workspace-path__label" title={crumbLabel(crumb)}>
            {crumbLabel(crumb)}
          </span>
        ) : (
          <button
            type="button"
            className="workspace-path__link"
            title={crumbLabel(crumb)}
            onClick={() => onOpen(crumb.id)}
          >
            <ItemIcon kind={crumb.kind} icon={crumb.icon ?? null} size="tree" />
            <span className="workspace-path__label">{crumbLabel(crumb)}</span>
          </button>
        )}
      </li>
    );
  };

  const renderFolded = () => (
    <li className="workspace-path__crumb workspace-path__crumb--folded">
      <MenuRoot placement="bottom-start">
        <MenuTrigger
          className="workspace-path__ellipsis"
          aria-label={HIDDEN_MENU_LABEL}
          data-testid="page-path-ellipsis"
        >
          …
        </MenuTrigger>
        <MenuContent aria-label={HIDDEN_MENU_LABEL}>
          {hiddenCrumbs.map((crumb) => (
            <MenuItem key={crumb.id} onClick={() => onOpen(crumb.id)}>
              <ItemIcon kind={crumb.kind} icon={crumb.icon ?? null} size="tree" />
              {crumbLabel(crumb)}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
    </li>
  );

  return (
    <nav
      ref={container}
      aria-label="Fil d’Ariane"
      className="workspace-path"
      data-testid="page-path"
      data-truncated={resolved.hidden.length > 0 || undefined}
    >
      <ol ref={measure} className="workspace-path__measure" aria-hidden="true">
        {path.map((crumb) => (
          <li key={crumb.id} className="workspace-path__crumb" data-measure="crumb">
            <span className="workspace-path__link">
              <ItemIcon kind={crumb.kind} icon={crumb.icon ?? null} size="tree" />
              <span className="workspace-path__label">{crumbLabel(crumb)}</span>
            </span>
          </li>
        ))}
        <li data-measure="separator">
          <Separator />
        </li>
        <li data-measure="ellipsis">
          <span className="ui-button workspace-path__ellipsis" data-size="square">
            …
          </span>
        </li>
      </ol>
      <ol className="workspace-path__list">
        {slots.map((slot, position) => (
          <Fragment key={slot.kind === "crumb" ? slot.crumb.id : "folded"}>
            {position === 0 ? null : <Separator />}
            {slot.kind === "crumb" ? renderCrumb(slot.crumb, slot.index) : renderFolded()}
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
