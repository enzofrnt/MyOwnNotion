import {
  type DatabaseBlockAttributes,
  type DatabaseProperty,
  type DatabaseRecord,
  generateUuidV7,
} from "@myownnotion/domain";

export function buildDatabaseFixture(
  recordCount: number,
  propertyCount = 6,
): DatabaseBlockAttributes {
  const databaseId = generateUuidV7();
  const propertyTypes = ["text", "number", "select", "date", "checkbox", "relation"] as const;
  const properties: DatabaseProperty[] = Array.from({ length: propertyCount }, (_, index) => {
    const type = propertyTypes[index % propertyTypes.length] ?? "text";
    const propertyId = generateUuidV7();
    return type === "select"
      ? {
          propertyId,
          name: `Select ${index}`,
          type,
          options: [
            { optionId: generateUuidV7(), name: "Planned" },
            { optionId: generateUuidV7(), name: "Active" },
            { optionId: generateUuidV7(), name: "Done" },
          ],
        }
      : { propertyId, name: `${type} ${index}`, type };
  });
  const recordIds = Array.from({ length: recordCount }, () => generateUuidV7());
  const records: DatabaseRecord[] = recordIds.map((recordId, recordIndex) => ({
    recordId,
    title: `Record ${String(recordIndex).padStart(4, "0")}`,
    values: properties.map((property, propertyIndex) => {
      switch (property.type) {
        case "text":
          return {
            propertyId: property.propertyId,
            type: "text" as const,
            value: `Text ${recordIndex}`,
          };
        case "number":
          return { propertyId: property.propertyId, type: "number" as const, value: recordIndex };
        case "select":
          return {
            propertyId: property.propertyId,
            type: "select" as const,
            value: property.options[recordIndex % property.options.length]?.optionId ?? null,
          };
        case "date":
          return {
            propertyId: property.propertyId,
            type: "date" as const,
            value: `2028-02-${String((recordIndex % 28) + 1).padStart(2, "0")}`,
          };
        case "checkbox":
          return {
            propertyId: property.propertyId,
            type: "checkbox" as const,
            value: recordIndex % 2 === 0,
          };
        case "relation":
          return {
            propertyId: property.propertyId,
            type: "relation" as const,
            value:
              recordIndex > 0 && propertyIndex < propertyCount
                ? [recordIds[recordIndex - 1] as (typeof recordIds)[number]]
                : [],
          };
        default:
          throw new Error("Unsupported database fixture property type");
      }
    }),
  }));
  const firstSelect = properties.find((property) => property.type === "select");
  return {
    databaseId,
    schemaVersion: 1,
    properties,
    records,
    view: {
      mode: "table",
      query: "",
      sortPropertyId: null,
      sortDirection: "asc",
      boardGroupPropertyId: firstSelect?.propertyId ?? null,
    },
  };
}

export function buildDatabaseDocument(database: DatabaseBlockAttributes = buildDatabaseFixture(3)) {
  return {
    format: "myownnotion.document+json" as const,
    formatVersion: 5,
    body: {
      type: "doc",
      content: [{ type: "databaseBlock", attrs: database }],
    },
  };
}
