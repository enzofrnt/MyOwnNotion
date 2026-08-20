import type {
  DatabaseDefinition,
  DatabaseProperty,
  TaskRoleMapping,
  Uuid,
} from "@myownnotion/domain";
import { useState } from "react";

function activeProperties(
  definition: DatabaseDefinition,
  accepts: (property: DatabaseProperty) => boolean,
): DatabaseProperty[] {
  return definition.properties.filter(
    (property) => property.state === "active" && accepts(property),
  );
}

function hasProperty(properties: readonly DatabaseProperty[], propertyId: Uuid | null): boolean {
  return propertyId === null || properties.some(({ id }) => id === propertyId);
}

function RoleSelect({
  id,
  label,
  value,
  properties,
  required,
  disabled,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: Uuid | null;
  readonly properties: readonly DatabaseProperty[];
  readonly required: boolean;
  readonly disabled: boolean;
  readonly onChange: (propertyId: Uuid | null) => void;
}) {
  const invalid = value !== null && !hasProperty(properties, value);
  return (
    <label className="database-field" htmlFor={id}>
      {label}
      <select
        id={id}
        value={value ?? ""}
        required={required}
        disabled={disabled}
        aria-invalid={invalid ? "true" : undefined}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : (event.target.value as Uuid))
        }
      >
        {required ? null : <option value="">Not configured</option>}
        {invalid ? <option value={value ?? ""}>Unavailable property</option> : null}
        {properties.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TaskConfiguration({
  definition,
  onChange,
}: {
  readonly definition: DatabaseDefinition;
  readonly onChange: (definition: DatabaseDefinition) => void | Promise<void>;
}) {
  const statusProperties = activeProperties(
    definition,
    (property) => property.type === "status" || property.type === "select",
  );
  const dateProperties = activeProperties(definition, (property) => property.type === "date");
  const roles = definition.taskRoles;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const invalid =
    roles !== null &&
    (!hasProperty(statusProperties, roles.statusPropertyId) ||
      !hasProperty(dateProperties, roles.dueDatePropertyId) ||
      !hasProperty(statusProperties, roles.priorityPropertyId));

  const replaceRoles = async (taskRoles: TaskRoleMapping | null): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await onChange({ ...definition, taskRoles });
    } catch {
      setSaveError("Task roles could not be saved. The previous configuration was restored.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="task-configuration" aria-labelledby="task-configuration-heading">
      <div className="task-configuration__heading">
        <div>
          <h3 id="task-configuration-heading">Task tracking</h3>
          <p className="muted">
            Task roles reference existing properties. Entries remain ordinary editable pages.
          </p>
        </div>
        {roles === null ? (
          <button
            type="button"
            disabled={statusProperties.length === 0 || saving}
            onClick={() => {
              const status = statusProperties[0];
              if (status !== undefined) {
                void replaceRoles({
                  statusPropertyId: status.id,
                  dueDatePropertyId: null,
                  priorityPropertyId: null,
                });
              }
            }}
          >
            Enable task tracking
          </button>
        ) : (
          <button
            type="button"
            className="link"
            disabled={saving}
            onClick={() => void replaceRoles(null)}
          >
            Disable task tracking
          </button>
        )}
      </div>

      {roles === null && statusProperties.length === 0 ? (
        <p role="status">Add an active status or select property before enabling task tracking.</p>
      ) : null}
      {invalid ? (
        <p role="alert">Task role configuration is invalid. Choose active compatible properties.</p>
      ) : null}
      {saveError === null ? null : <p role="alert">{saveError}</p>}
      {saving ? <p role="status">Saving task roles locally…</p> : null}

      {roles === null ? null : (
        <div className="task-configuration__roles">
          <RoleSelect
            id={`task-status-${definition.databaseId}`}
            label="Task status property"
            value={roles.statusPropertyId}
            properties={statusProperties}
            required
            disabled={saving}
            onChange={(statusPropertyId) => {
              if (statusPropertyId !== null) void replaceRoles({ ...roles, statusPropertyId });
            }}
          />
          <RoleSelect
            id={`task-due-${definition.databaseId}`}
            label="Task due date property"
            value={roles.dueDatePropertyId}
            properties={dateProperties}
            required={false}
            disabled={saving}
            onChange={(dueDatePropertyId) => void replaceRoles({ ...roles, dueDatePropertyId })}
          />
          <RoleSelect
            id={`task-priority-${definition.databaseId}`}
            label="Task priority property"
            value={roles.priorityPropertyId}
            properties={statusProperties}
            required={false}
            disabled={saving}
            onChange={(priorityPropertyId) => void replaceRoles({ ...roles, priorityPropertyId })}
          />
        </div>
      )}
    </section>
  );
}
