import {
  Menu as AriakitMenu,
  MenuButton as AriakitMenuButton,
  type MenuButtonProps as AriakitMenuButtonProps,
  MenuGroupLabel as AriakitMenuGroupLabel,
  type MenuGroupLabelProps as AriakitMenuGroupLabelProps,
  MenuItem as AriakitMenuItem,
  type MenuItemProps as AriakitMenuItemProps,
  type MenuProps as AriakitMenuProps,
  MenuProvider as AriakitMenuProvider,
  type MenuProviderProps as AriakitMenuProviderProps,
  MenuSeparator as AriakitMenuSeparator,
  type MenuSeparatorProps as AriakitMenuSeparatorProps,
} from "@ariakit/react";
import { forwardRef, type ReactNode } from "react";
import { classNames } from "../class-names.ts";

export type MenuRootProps = AriakitMenuProviderProps;

export function MenuRoot(props: MenuRootProps) {
  return <AriakitMenuProvider {...props} />;
}

export type MenuTriggerProps = Omit<AriakitMenuButtonProps, "className"> & {
  readonly className?: string;
};

export const MenuTrigger = forwardRef<HTMLButtonElement, MenuTriggerProps>(function MenuTrigger(
  { className, ...props },
  ref,
) {
  return (
    <AriakitMenuButton
      {...props}
      ref={ref}
      className={classNames("ui-button", "ui-menu__trigger", className)}
      data-size="square"
      data-variant="ghost"
    />
  );
});

export type MenuContentProps = Omit<AriakitMenuProps, "className"> & {
  readonly className?: string;
};

export const MenuContent = forwardRef<HTMLDivElement, MenuContentProps>(function MenuContent(
  { className, gutter = 6, portal = true, ...props },
  ref,
) {
  return (
    <AriakitMenu
      {...props}
      ref={ref}
      className={classNames("ui-menu", className)}
      gutter={gutter}
      portal={portal}
    />
  );
});

export type MenuItemProps = Omit<AriakitMenuItemProps, "className"> & {
  readonly className?: string;
  readonly destructive?: boolean;
  readonly shortcut?: ReactNode;
};

export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem(
  { children, className, destructive = false, shortcut, ...props },
  ref,
) {
  return (
    <AriakitMenuItem
      {...props}
      ref={ref}
      className={classNames("ui-menu__item", className)}
      data-destructive={destructive || undefined}
    >
      <span className="ui-menu__item-label">{children}</span>
      {shortcut === undefined ? null : <kbd className="ui-shortcut">{shortcut}</kbd>}
    </AriakitMenuItem>
  );
});

export type MenuLabelProps = Omit<AriakitMenuGroupLabelProps, "className"> & {
  readonly className?: string;
};

export const MenuLabel = forwardRef<HTMLDivElement, MenuLabelProps>(function MenuLabel(
  { className, ...props },
  ref,
) {
  return (
    <AriakitMenuGroupLabel
      {...props}
      ref={ref}
      className={classNames("ui-menu__label", className)}
    />
  );
});

export type MenuSeparatorProps = Omit<AriakitMenuSeparatorProps, "className"> & {
  readonly className?: string;
};

export const MenuSeparator = forwardRef<HTMLHRElement, MenuSeparatorProps>(function MenuSeparator(
  { className, ...props },
  ref,
) {
  return (
    <AriakitMenuSeparator
      {...props}
      ref={ref}
      className={classNames("ui-menu__separator", className)}
    />
  );
});
