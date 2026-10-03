import type { DatabaseViewType } from "@myownnotion/domain";
import { AppIcon, type AppIconSize } from "../../ui/icons.tsx";
import {
  SYMBOL_ICON_CHOICES,
  type SymbolIconChoice,
  symbolIconChoice,
} from "../../ui/symbol-icons.ts";
import { VIEW_TYPE_ICON } from "./view-tab-names.ts";

export type ViewIconChoice = SymbolIconChoice;
export const VIEW_ICON_CHOICES = SYMBOL_ICON_CHOICES;

export function viewIconChoice(id: string | null | undefined): ViewIconChoice | null {
  return symbolIconChoice(id);
}

const MARK_SIZE: Readonly<Record<AppIconSize, number>> = {
  small: 14,
  medium: 18,
  large: 22,
};

export function ViewMark({
  icon,
  type,
  size = "small",
}: {
  readonly icon?: string | null | undefined;
  readonly type: DatabaseViewType;
  readonly size?: AppIconSize;
}) {
  const choice = viewIconChoice(icon);
  if (choice === null) return <AppIcon name={VIEW_TYPE_ICON[type]} size={size} />;
  const Icon = choice.Icon;
  return (
    <Icon
      className="ui-icon"
      size={MARK_SIZE[size]}
      focusable="false"
      aria-hidden="true"
      data-icon={choice.id}
    />
  );
}
