import type { DatabaseProperty } from "@myownnotion/domain";
import { useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { PopoverContent, PopoverRoot, PopoverTrigger } from "../../ui/primitives/index.ts";
import { DatabaseIconPicker } from "./database-icon-picker.tsx";
import { viewIconChoice } from "./view-icon.tsx";

/** Same property markers in the grid and in the canonical entry page. */
export function DatabasePropertyIcon({
  type,
  icon,
}: {
  readonly type: DatabaseProperty["type"];
  readonly icon?: string | null | undefined;
}) {
  const choice = viewIconChoice(icon);
  if (choice !== null) {
    const Icon = choice.Icon;
    return (
      <Icon
        className="ui-icon"
        size={14}
        focusable="false"
        aria-hidden="true"
        data-icon={choice.id}
      />
    );
  }
  if (type === "title" || type === "text") return <span aria-hidden="true">Aa</span>;
  if (type === "number") return <span aria-hidden="true">#</span>;
  return (
    <AppIcon
      name={
        type === "date"
          ? "calendar"
          : type === "checkbox"
            ? "check"
            : type === "relation"
              ? "link"
              : "list"
      }
      size="small"
    />
  );
}

export function PropertyIconPicker({
  property,
  onChange,
}: {
  readonly property: Pick<DatabaseProperty, "type" | "name" | "icon">;
  readonly onChange: (icon: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <PopoverRoot placement="bottom-start">
      <PopoverTrigger
        className="property-icon-picker__trigger"
        aria-label={`Changer l’icône de ${property.name}`}
      >
        <DatabasePropertyIcon type={property.type} icon={property.icon} />
      </PopoverTrigger>
      <PopoverContent
        className="database-view-icon-picker"
        aria-label={`Icône de ${property.name}`}
        unmountOnHide
      >
        <DatabaseIconPicker
          current={property.icon ?? null}
          query={query}
          onQuery={setQuery}
          onSelect={(icon) => {
            setQuery("");
            onChange(icon);
          }}
        />
      </PopoverContent>
    </PopoverRoot>
  );
}
