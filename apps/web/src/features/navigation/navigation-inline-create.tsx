import { type KeyboardEvent, type MouseEvent, type PointerEvent, useEffect, useRef } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button } from "../../ui/primitives/index.ts";

export interface NavigationInlineCreateProps {
  readonly itemName: string;
  readonly open: boolean;
  readonly variant?: "item" | "root";
  readonly testIds?: {
    readonly root?: string;
    readonly toggle?: string;
    readonly page?: string;
    readonly folder?: string;
  };
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreatePage: () => void;
  readonly onCreateFolder: () => void;
}

/**
 * Compact child creation that expands over the row instead of widening it.
 *
 * The two choices stay mounted for a symmetric close transition, but leave the
 * tab order while hidden. The final control is always the same `+`: rotation
 * turns it into the close cross, so there is no second floating affordance.
 */
export function NavigationInlineCreate({
  itemName,
  onCreateFolder,
  onCreatePage,
  onOpenChange,
  open,
  testIds,
  variant = "item",
}: NavigationInlineCreateProps) {
  const root = useRef<HTMLSpanElement | null>(null);
  const firstChoice = useRef<HTMLButtonElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const focusChoiceOnOpen = useRef(false);
  const stopPointer = (event: PointerEvent<HTMLButtonElement>): void => event.stopPropagation();
  const create = (event: MouseEvent<HTMLButtonElement>, kind: "page" | "folder"): void => {
    event.stopPropagation();
    onOpenChange(false);
    if (kind === "page") onCreatePage();
    else onCreateFolder();
  };

  useEffect(() => {
    if (!open || !focusChoiceOnOpen.current) return;
    focusChoiceOnOpen.current = false;
    firstChoice.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: globalThis.PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || root.current?.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [open, onOpenChange]);

  const closeFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    toggle.current?.focus();
    onOpenChange(false);
  };

  return (
    <span
      ref={root}
      className="navigation-inline-create"
      data-testid={testIds?.root ?? `inline-create-${itemName}`}
      data-open={open || undefined}
      data-variant={variant}
    >
      <span className="navigation-inline-create__surface">
        <span
          className="navigation-inline-create__choices"
          aria-hidden={!open}
          data-visible={open || undefined}
        >
          <Button
            ref={firstChoice}
            type="button"
            size="square"
            variant="ghost"
            tabIndex={open ? 0 : -1}
            data-testid={testIds?.page ?? `new-page-inline-${itemName}`}
            aria-label={`Nouvelle page dans ${itemName}`}
            title="Nouvelle page"
            onPointerDown={stopPointer}
            onKeyDown={closeFromKeyboard}
            onClick={(event) => create(event, "page")}
          >
            <AppIcon name="fileAdd" size="small" />
          </Button>
          <Button
            type="button"
            size="square"
            variant="ghost"
            tabIndex={open ? 0 : -1}
            data-testid={testIds?.folder ?? `new-folder-inline-${itemName}`}
            aria-label={`Nouveau dossier dans ${itemName}`}
            title="Nouveau dossier"
            onPointerDown={stopPointer}
            onKeyDown={closeFromKeyboard}
            onClick={(event) => create(event, "folder")}
          >
            <AppIcon name="folderAdd" size="small" />
          </Button>
        </span>
        <Button
          ref={toggle}
          type="button"
          size="square"
          variant="ghost"
          className="navigation-inline-create__toggle"
          data-testid={testIds?.toggle ?? `toggle-inline-create-${itemName}`}
          aria-label={
            open
              ? `Fermer la création dans ${itemName}`
              : variant === "root"
                ? "Créer un nouvel élément"
                : `Ajouter dans ${itemName}`
          }
          aria-expanded={open}
          title={open ? "Fermer" : variant === "root" ? "Nouveau" : "Ajouter dans cette page"}
          onPointerDown={stopPointer}
          onKeyDown={closeFromKeyboard}
          onClick={(event) => {
            event.stopPropagation();
            const nextOpen = !open;
            focusChoiceOnOpen.current = nextOpen && event.detail === 0;
            onOpenChange(nextOpen);
          }}
        >
          <AppIcon name="add" size="small" />
        </Button>
      </span>
    </span>
  );
}
