import { AppIcon } from "./icons.tsx";
import { InputSurface, NativeInput } from "./primitives/index.ts";
import { SYMBOL_ICON_CHOICES } from "./symbol-icons.ts";

/** The symbol catalog shared by page icons, property icons and view icons. */
export function SymbolIconGrid({
  current,
  onQuery,
  onSelect,
  query,
}: {
  readonly current: string | null;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onSelect: (icon: string) => void;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const choices = SYMBOL_ICON_CHOICES.filter((choice) =>
    needle === ""
      ? true
      : choice.label.toLocaleLowerCase().includes(needle) || choice.id.includes(needle),
  );
  return (
    <>
      <InputSurface className="database-view-icon-picker__search" density="compact">
        <AppIcon name="search" size="small" />
        <NativeInput
          aria-label="Filtrer les icônes"
          placeholder="Filtrer…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </InputSurface>
      <p className="database-view-icon-picker__section">Icônes</p>
      <div className="database-view-icon-picker__grid" role="listbox" aria-label="Icônes">
        {choices.map((choice) => {
          const Icon = choice.Icon;
          return (
            <button
              key={choice.id}
              type="button"
              className="database-view-icon-picker__choice"
              role="option"
              aria-label={choice.label}
              aria-selected={choice.id === current}
              onClick={() => onSelect(choice.id)}
            >
              <Icon size={18} focusable="false" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {choices.length === 0 ? (
        <p className="database-view-icon-picker__empty" role="status">
          Aucune icône trouvée.
        </p>
      ) : null}
    </>
  );
}
