import type { DatabaseProperty, DatabaseView, Uuid } from "@myownnotion/domain";
import { useLayoutEffect, useRef, useState } from "react";
import { AppIcon } from "../../ui/icons.tsx";
import { Button, MenuContent, MenuItem, MenuRoot, MenuTrigger } from "../../ui/primitives/index.ts";
import { DATABASE_COPY } from "./database-copy.ts";
import { DatabasePropertyIcon } from "./property-icon.tsx";

export function groupingPropertyId(view: DatabaseView): Uuid | undefined {
  return view.type === "board" ? view.options.axisPropertyId : view.group?.propertyId;
}

export function groupableProperties(
  properties: readonly DatabaseProperty[],
  type: DatabaseView["type"],
): readonly DatabaseProperty[] {
  return properties.filter(
    (property) =>
      property.state === "active" &&
      (property.type === "status" ||
        property.type === "select" ||
        property.type === "multi-select" ||
        (type !== "board" && property.type === "checkbox")),
  );
}

/** Only the axis-specific column layout resets; the rest of the view stays intact. */
export function withGroupingProperty(view: DatabaseView, propertyId: Uuid | null): DatabaseView {
  const group = propertyId === null ? null : { propertyId };
  if (view.type !== "board") return { ...view, group };
  if (propertyId === null) return view;
  return {
    ...view,
    group,
    options: {
      ...view.options,
      axisPropertyId: propertyId,
      ...(propertyId === view.options.axisPropertyId
        ? {}
        : { columnOrder: [], collapsedColumnIds: [] }),
    },
  };
}

export function GroupEditor({
  properties,
  view,
  onChange,
}: {
  readonly properties: readonly DatabaseProperty[];
  readonly view: DatabaseView;
  readonly onChange: (view: DatabaseView) => void | Promise<void>;
}) {
  const choices = groupableProperties(properties, view.type);
  const currentId = groupingPropertyId(view);
  const current = choices.find((property) => property.id === currentId);
  const label = current?.name ?? (currentId === undefined ? "Aucun" : "Indisponible");
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<{ propertyId: Uuid | null; label: string } | null>(null);
  useLayoutEffect(() => {
    if (saving || !restoreFocus.current) return;
    restoreFocus.current = false;
    // Disabling the trigger during the write can prevent the menu's return focus.
    // Restore it after the write, unless the owner has focused another control.
    const active = document.activeElement;
    if (active === document.body || active?.closest(".database-group-settings__menu")) {
      trigger.current?.focus({ preventScroll: true });
    }
  }, [saving]);
  const select = async (propertyId: Uuid | null): Promise<void> => {
    const choice = choices.find((property) => property.id === propertyId);
    if (
      busy.current ||
      (propertyId ?? undefined) === currentId ||
      (propertyId === null ? view.type === "board" : choice === undefined)
    )
      return;
    busy.current = true;
    restoreFocus.current =
      document.activeElement?.closest(".database-group-settings__menu") != null;
    setSaving(true);
    setFailed(null);
    try {
      await onChange(withGroupingProperty(view, propertyId));
    } catch {
      setFailed({ propertyId, label: choice?.name ?? "Aucun" });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="database-group-settings" aria-busy={saving}>
      <MenuRoot placement="bottom-end">
        <MenuTrigger
          ref={trigger}
          bare
          className="database-view-settings__row"
          aria-label={`Grouper par ${label}`}
          disabled={saving || (view.type === "board" && choices.length === 0)}
        >
          <span className="database-view-settings__row-label">Grouper par</span>
          <span className="database-view-settings__aside">{label}</span>
          <AppIcon name="chevronRight" size="small" />
        </MenuTrigger>
        <MenuContent className="database-group-settings__menu" aria-label="Grouper par">
          {view.type === "board" ? null : (
            <MenuItem onClick={() => void select(null)}>
              <AppIcon name="close" size="small" />
              <span className="database-group-settings__choice">Aucun</span>
              {currentId === undefined ? <AppIcon name="check" size="small" /> : null}
            </MenuItem>
          )}
          {choices.map((property) => (
            <MenuItem key={property.id} onClick={() => void select(property.id)}>
              <DatabasePropertyIcon type={property.type} icon={property.icon} />
              <span className="database-group-settings__choice">{property.name}</span>
              {property.id === currentId ? <AppIcon name="check" size="small" /> : null}
            </MenuItem>
          ))}
        </MenuContent>
      </MenuRoot>
      {choices.length === 0 ? (
        <p className="database-view-settings__hint">
          {view.type === "board"
            ? DATABASE_COPY.board.needsProperty
            : "Ajoutez une propriété de statut, sélection, sélection multiple ou case à cocher pour regrouper les entrées."}
        </p>
      ) : null}
      <span className="sr-only" role="status">
        {saving ? "Enregistrement du regroupement…" : ""}
      </span>
      {failed === null ? null : (
        <div className="database-group-settings__error">
          <p role="alert">Le regroupement par « {failed.label} » n’a pas pu être appliqué.</p>
          <Button size="compact" variant="ghost" onClick={() => void select(failed.propertyId)}>
            Réessayer
          </Button>
        </div>
      )}
    </div>
  );
}
