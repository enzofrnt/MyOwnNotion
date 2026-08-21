import type { MouseEvent, ReactNode } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "../../ui/primitives/index.ts";

export interface NavigationItemMenuProps {
  readonly itemName: string;
  readonly canContainChildren: boolean;
  readonly canMoveToRoot: boolean;
  readonly canMoveSelectedInside: boolean;
  readonly favourite: boolean;
  readonly keptOffline: boolean;
  readonly conversion?: ReactNode;
  readonly onCreatePage: () => void;
  readonly onCreateFolder: () => void;
  readonly onCreateDatabase: () => void;
  readonly onRename: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
  readonly onMoveToRoot: () => void;
  readonly onMoveSelectedInside: () => void;
  readonly onToggleFavourite: () => void;
  readonly onToggleOffline: () => void;
  readonly onTrash: () => void;
}

export function NavigationItemMenu({
  canContainChildren,
  canMoveSelectedInside,
  canMoveToRoot,
  conversion,
  favourite,
  itemName,
  keptOffline,
  onCreateDatabase,
  onCreateFolder,
  onCreatePage,
  onMoveDown,
  onMoveSelectedInside,
  onMoveToRoot,
  onMoveUp,
  onRename,
  onToggleFavourite,
  onToggleOffline,
  onTrash,
}: NavigationItemMenuProps) {
  return (
    <span className="navigation-item-actions">
      {conversion}
      <MenuRoot>
        <MenuTrigger
          className="navigation-item-menu__trigger"
          data-testid={`item-actions-${itemName}`}
          aria-label={`Actions pour ${itemName}`}
          onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
        >
          <AppIcon name="more" />
        </MenuTrigger>
        <MenuContent
          className="navigation-item-menu__content"
          aria-label={`Actions pour ${itemName}`}
          onClick={(event) => event.stopPropagation()}
        >
          {canContainChildren ? (
            <>
              <MenuItem data-testid={`new-page-inside-${itemName}`} onClick={onCreatePage}>
                <AppIcon name="fileText" size="small" />
                Nouvelle page à l’intérieur
              </MenuItem>
              <MenuItem data-testid={`new-folder-inside-${itemName}`} onClick={onCreateFolder}>
                <AppIcon name="folder" size="small" />
                Nouveau dossier à l’intérieur
              </MenuItem>
              <MenuItem data-testid={`new-database-inside-${itemName}`} onClick={onCreateDatabase}>
                <AppIcon name="table" size="small" />
                Nouvelle base à l’intérieur
              </MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem data-testid={`rename-${itemName}`} onClick={onRename} shortcut="F2">
            <AppIcon name="fileText" size="small" />
            Renommer
          </MenuItem>
          <MenuItem data-testid={`move-up-${itemName}`} onClick={onMoveUp}>
            <AppIcon name="arrowUp" size="small" />
            Déplacer vers le haut
          </MenuItem>
          <MenuItem data-testid={`move-down-${itemName}`} onClick={onMoveDown}>
            <AppIcon name="arrowDown" size="small" />
            Déplacer vers le bas
          </MenuItem>
          {canMoveToRoot ? (
            <MenuItem data-testid={`move-root-${itemName}`} onClick={onMoveToRoot}>
              <AppIcon name="arrowLeft" size="small" />
              Déplacer à la racine
            </MenuItem>
          ) : null}
          {canMoveSelectedInside ? (
            <MenuItem
              data-testid={`move-selected-inside-${itemName}`}
              onClick={onMoveSelectedInside}
            >
              <AppIcon name="arrowRight" size="small" />
              Déplacer la sélection à l’intérieur
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={favourite}
            data-testid={`favourite-action-${itemName}`}
            onClick={onToggleFavourite}
          >
            <AppIcon name={favourite ? "remove" : "add"} size="small" />
            {favourite ? "Retirer des favoris" : "Ajouter aux favoris"}
          </MenuItem>
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={keptOffline}
            data-testid={`offline-action-${itemName}`}
            onClick={onToggleOffline}
          >
            <AppIcon name={keptOffline ? "remove" : "download"} size="small" />
            {keptOffline ? "Ne plus conserver hors ligne" : "Conserver hors ligne"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem destructive data-testid={`trash-${itemName}`} onClick={onTrash}>
            <AppIcon name="delete" size="small" />
            Placer dans la corbeille
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </span>
  );
}
