import type { DatabaseProperty } from "@myownnotion/domain";
import { useState } from "react";
import { AppIcon, type AppIconName } from "../../ui/icons.tsx";
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
        size={16}
        focusable="false"
        aria-hidden="true"
        data-icon={choice.id}
      />
    );
  }
  const name =
    type === "title" || type === "text"
      ? "type"
      : type === "number"
        ? "hash"
        : type === "unique-id"
          ? "fingerprint"
          : type === "status"
            ? "status"
            : type === "select"
              ? "select"
              : type === "multi-select"
                ? "list"
                : type === "checkbox"
                  ? "checkbox"
                  : type === "date"
                    ? "calendar"
                    : type === "created-time" || type === "last-edited-time"
                      ? "clock"
                      : type === "files"
                        ? "paperclip"
                        : type === "rollup" || type === "formula"
                          ? "rollup"
                          : type === "relation" || type === "url"
                            ? "link"
                            : type === "email"
                              ? "mail"
                              : type === "phone"
                                ? "phone"
                                : type === "place"
                                  ? "mapPin"
                                  : "list";
  return <AppIcon name={name} size="small" />;
}

export function PropertyIconPicker({
  property,
  onChange,
  placeholderIcon,
}: {
  readonly property: Pick<DatabaseProperty, "type" | "name" | "icon">;
  readonly onChange: (icon: string | null) => void;
  /** Mark for a field that is being created and has no icon yet. */
  readonly placeholderIcon?: AppIconName;
}) {
  const [query, setQuery] = useState("");
  return (
    <PopoverRoot placement="bottom-start">
      <PopoverTrigger
        className="property-icon-picker__trigger"
        aria-label={`Changer l’icône de ${property.name}`}
      >
        {property.icon === null || property.icon === undefined ? (
          placeholderIcon === undefined ? (
            <DatabasePropertyIcon type={property.type} icon={property.icon} />
          ) : (
            <AppIcon name={placeholderIcon} size="small" />
          )
        ) : (
          <DatabasePropertyIcon type={property.type} icon={property.icon} />
        )}
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
