import {
  type DatabaseBlockAttributes,
  type DatabaseProperty,
  type DatabasePropertyType,
  type DatabaseRecord,
  type DatabaseValue,
  type DatabaseView,
  generateUuidV7,
  isUuid,
  type Uuid,
  validateDatabaseBlockAttributes,
} from "@myownnotion/domain";

export type DatabaseIdFactory = () => Uuid;

function normalizedName(name: string): string | null {
  const value = name.trim();
  return value.length > 0 && value.length <= 128 ? value : null;
}

function validated(
  candidate: DatabaseBlockAttributes,
  fallback: DatabaseBlockAttributes,
): DatabaseBlockAttributes {
  const result = validateDatabaseBlockAttributes(candidate);
  return result.ok ? result.value : fallback;
}

export function addDatabaseProperty(
  database: DatabaseBlockAttributes,
  name: string,
  type: DatabasePropertyType,
  idFactory: DatabaseIdFactory = generateUuidV7,
): DatabaseBlockAttributes {
  const normalized = normalizedName(name);
  if (
    normalized === null ||
    database.properties.length >= 20 ||
    database.properties.some(
      (property) => property.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
    )
  ) {
    return database;
  }
  const propertyId = idFactory();
  const property: DatabaseProperty =
    type === "select"
      ? { propertyId, name: normalized, type, options: [] }
      : { propertyId, name: normalized, type };
  return validated({ ...database, properties: [...database.properties, property] }, database);
}

export function renameDatabaseProperty(
  database: DatabaseBlockAttributes,
  propertyId: Uuid,
  name: string,
): DatabaseBlockAttributes {
  const normalized = normalizedName(name);
  if (
    normalized === null ||
    database.properties.some(
      (property) =>
        property.propertyId !== propertyId &&
        property.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
    )
  ) {
    return database;
  }
  return validated(
    {
      ...database,
      properties: database.properties.map((property) =>
        property.propertyId === propertyId ? { ...property, name: normalized } : property,
      ),
    },
    database,
  );
}

export function removeDatabaseProperty(
  database: DatabaseBlockAttributes,
  propertyId: Uuid,
): DatabaseBlockAttributes {
  const properties = database.properties.filter((property) => property.propertyId !== propertyId);
  if (properties.length === database.properties.length) return database;
  return validated(
    {
      ...database,
      properties,
      records: database.records.map((record) => ({
        ...record,
        values: record.values.filter((value) => value.propertyId !== propertyId),
      })),
      view: {
        ...database.view,
        sortPropertyId:
          database.view.sortPropertyId === propertyId ? null : database.view.sortPropertyId,
        boardGroupPropertyId:
          database.view.boardGroupPropertyId === propertyId
            ? null
            : database.view.boardGroupPropertyId,
      },
    },
    database,
  );
}

export function addSelectOption(
  database: DatabaseBlockAttributes,
  propertyId: Uuid,
  name: string,
  idFactory: DatabaseIdFactory = generateUuidV7,
): DatabaseBlockAttributes {
  const normalized = normalizedName(name);
  if (normalized === null) return database;
  return validated(
    {
      ...database,
      properties: database.properties.map((property) => {
        if (
          property.propertyId !== propertyId ||
          property.type !== "select" ||
          property.options.length >= 50 ||
          property.options.some(
            (option) => option.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
          )
        ) {
          return property;
        }
        return {
          ...property,
          options: [...property.options, { optionId: idFactory(), name: normalized }],
        };
      }),
    },
    database,
  );
}

export function renameSelectOption(
  database: DatabaseBlockAttributes,
  propertyId: Uuid,
  optionId: Uuid,
  name: string,
): DatabaseBlockAttributes {
  const normalized = normalizedName(name);
  if (normalized === null) return database;
  return validated(
    {
      ...database,
      properties: database.properties.map((property) => {
        if (
          property.propertyId !== propertyId ||
          property.type !== "select" ||
          property.options.some(
            (option) =>
              option.optionId !== optionId &&
              option.name.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
          )
        ) {
          return property;
        }
        return {
          ...property,
          options: property.options.map((option) =>
            option.optionId === optionId ? { ...option, name: normalized } : option,
          ),
        };
      }),
    },
    database,
  );
}

export function removeSelectOption(
  database: DatabaseBlockAttributes,
  propertyId: Uuid,
  optionId: Uuid,
): DatabaseBlockAttributes {
  return validated(
    {
      ...database,
      properties: database.properties.map((property) =>
        property.propertyId === propertyId && property.type === "select"
          ? {
              ...property,
              options: property.options.filter((option) => option.optionId !== optionId),
            }
          : property,
      ),
      records: database.records.map((record) => ({
        ...record,
        values: record.values.map((value) =>
          value.propertyId === propertyId && value.type === "select" && value.value === optionId
            ? { ...value, value: null }
            : value,
        ),
      })),
    },
    database,
  );
}

export function addDatabaseRecord(
  database: DatabaseBlockAttributes,
  title: string,
  idFactory: DatabaseIdFactory = generateUuidV7,
): DatabaseBlockAttributes {
  if (title.length > 512 || database.records.length >= 1_000) return database;
  return validated(
    {
      ...database,
      records: [...database.records, { recordId: idFactory(), title, values: [] }],
    },
    database,
  );
}

export function renameDatabaseRecord(
  database: DatabaseBlockAttributes,
  recordId: Uuid,
  title: string,
): DatabaseBlockAttributes {
  if (title.length > 512) return database;
  return validated(
    {
      ...database,
      records: database.records.map((record) =>
        record.recordId === recordId ? { ...record, title } : record,
      ),
    },
    database,
  );
}

export function removeDatabaseRecord(
  database: DatabaseBlockAttributes,
  recordId: Uuid,
): DatabaseBlockAttributes {
  return validated(
    {
      ...database,
      records: database.records.filter((record) => record.recordId !== recordId),
    },
    database,
  );
}

function nextValue(
  property: DatabaseProperty,
  input: string | boolean | readonly Uuid[],
): DatabaseValue | null {
  switch (property.type) {
    case "text":
      return typeof input === "string" && input.length <= 10_000
        ? { propertyId: property.propertyId, type: "text", value: input }
        : null;
    case "number": {
      if (typeof input !== "string") return null;
      const parsed = input.trim() === "" ? null : Number(input);
      return parsed === null || Number.isFinite(parsed)
        ? { propertyId: property.propertyId, type: "number", value: parsed }
        : null;
    }
    case "select":
      return typeof input === "string" &&
        (input === "" ||
          (isUuid(input) && property.options.some((option) => option.optionId === input)))
        ? {
            propertyId: property.propertyId,
            type: "select",
            value: input === "" ? null : input,
          }
        : null;
    case "date":
      return typeof input === "string"
        ? { propertyId: property.propertyId, type: "date", value: input === "" ? null : input }
        : null;
    case "checkbox":
      return typeof input === "boolean"
        ? { propertyId: property.propertyId, type: "checkbox", value: input }
        : null;
    case "relation":
      return Array.isArray(input) && input.every((value) => isUuid(value))
        ? { propertyId: property.propertyId, type: "relation", value: [...new Set(input)] }
        : null;
  }
}

export function updateDatabaseValue(
  database: DatabaseBlockAttributes,
  recordId: Uuid,
  propertyId: Uuid,
  input: string | boolean | readonly Uuid[],
): DatabaseBlockAttributes {
  const property = database.properties.find((entry) => entry.propertyId === propertyId);
  if (property === undefined) return database;
  const value = nextValue(property, input);
  if (value === null) return database;
  const candidate = {
    ...database,
    records: database.records.map((record) =>
      record.recordId === recordId
        ? {
            ...record,
            values: [...record.values.filter((entry) => entry.propertyId !== propertyId), value],
          }
        : record,
    ),
  };
  const result = validateDatabaseBlockAttributes(candidate);
  return result.ok ? result.value : database;
}

export function updateDatabaseView(
  database: DatabaseBlockAttributes,
  patch: Partial<DatabaseView>,
): DatabaseBlockAttributes {
  const candidate = { ...database, view: { ...database.view, ...patch } };
  const result = validateDatabaseBlockAttributes(candidate);
  return result.ok ? result.value : database;
}

export function recordById(
  database: DatabaseBlockAttributes,
  recordId: Uuid,
): DatabaseRecord | null {
  return database.records.find((record) => record.recordId === recordId) ?? null;
}
