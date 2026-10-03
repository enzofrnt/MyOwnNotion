import { usePopoverContext } from "@ariakit/react";
import { SymbolIconGrid } from "../../ui/symbol-icon-grid.tsx";
import { symbolIconChoice } from "../../ui/symbol-icons.ts";

export function DatabaseIconPicker({
  current,
  onQuery,
  onSelect,
  query,
}: {
  readonly current: string | null;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onSelect: (icon: string | null) => void;
}) {
  const popover = usePopoverContext();
  const choose = (icon: string | null): void => {
    onSelect(icon);
    popover?.hide();
  };
  const selected = symbolIconChoice(current);
  return (
    <>
      <div className="database-view-icon-picker__header">
        <p className="database-view-icon-picker__title">Icône</p>
        <button
          type="button"
          className="database-view-icon-picker__remove"
          disabled={selected === null}
          onClick={() => choose(null)}
        >
          Supprimer
        </button>
      </div>
      <SymbolIconGrid
        current={selected?.id ?? null}
        query={query}
        onQuery={onQuery}
        onSelect={(icon) => choose(icon)}
      />
    </>
  );
}
