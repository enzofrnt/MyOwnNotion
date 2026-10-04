import type { DatabaseProperty, Uuid } from "@myownnotion/domain";
import { Switch } from "../../ui/primitives/index.ts";
export function PropertyVisibilitySwitch({
  property,
  visible,
  onToggle,
}: {
  readonly property: DatabaseProperty;
  readonly visible: boolean;
  readonly onToggle: (propertyId: Uuid, visible: boolean) => void;
}) {
  return (
    <Switch
      checked={visible}
      disabled={property.type === "title"}
      aria-label={
        property.type === "title"
          ? `${property.name}, toujours visible`
          : `Afficher ${property.name} dans cette vue`
      }
      onCheckedChange={(value) => onToggle(property.id, value)}
    />
  );
}
