import { createEmptyDatabaseAttributes, generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  addDatabaseProperty,
  addDatabaseRecord,
  addSelectOption,
  removeDatabaseProperty,
  removeDatabaseRecord,
  removeSelectOption,
  renameDatabaseRecord,
  renameSelectOption,
  updateDatabaseValue,
  updateDatabaseView,
} from "./database-block.ts";

describe("database block editing commands", () => {
  it("adds stable properties and rejects duplicate names", () => {
    const firstId = generateUuidV7();
    const created = addDatabaseProperty(
      createEmptyDatabaseAttributes(generateUuidV7()),
      "Status",
      "select",
      () => firstId,
    );
    expect(created.properties).toEqual([
      { propertyId: firstId, name: "Status", type: "select", options: [] },
    ]);
    expect(addDatabaseProperty(created, " status ", "text")).toBe(created);
    expect(addDatabaseProperty(created, "Owner", "text", () => firstId)).toBe(created);
  });

  it("removes a property, every value, and dependent view configuration atomically", () => {
    const propertyId = generateUuidV7();
    const recordId = generateUuidV7();
    let database = addDatabaseProperty(
      createEmptyDatabaseAttributes(generateUuidV7()),
      "Status",
      "select",
      () => propertyId,
    );
    database = addSelectOption(database, propertyId, "Active");
    database = addDatabaseRecord(database, "One", () => recordId);
    const optionId =
      database.properties[0]?.type === "select"
        ? database.properties[0].options[0]?.optionId
        : undefined;
    if (optionId === undefined) throw new Error("Option missing");
    database = updateDatabaseValue(database, recordId, propertyId, optionId);
    database = updateDatabaseView(database, {
      sortPropertyId: propertyId,
      boardGroupPropertyId: propertyId,
    });
    expect(removeDatabaseProperty(database, propertyId)).toMatchObject({
      properties: [],
      records: [{ recordId, values: [] }],
      view: { sortPropertyId: null, boardGroupPropertyId: null },
    });
  });

  it("edits every supported value without changing record identity", () => {
    const types = ["text", "number", "select", "date", "checkbox", "relation"] as const;
    let database = createEmptyDatabaseAttributes(generateUuidV7());
    const propertyIds = types.map(() => generateUuidV7());
    for (const [index, type] of types.entries()) {
      const propertyId = propertyIds[index];
      if (propertyId === undefined) throw new Error("Property identity missing");
      database = addDatabaseProperty(database, `Property ${index}`, type, () => propertyId);
    }
    const targetId = generateUuidV7();
    const recordId = generateUuidV7();
    database = addDatabaseRecord(database, "Target", () => targetId);
    database = addDatabaseRecord(database, "Source", () => recordId);
    const selectPropertyId = propertyIds[2];
    if (selectPropertyId === undefined) throw new Error("Select property identity missing");
    database = addSelectOption(database, selectPropertyId, "Active");
    const option = database.properties[2];
    const optionId = option?.type === "select" ? option.options[0]?.optionId : undefined;
    if (optionId === undefined) throw new Error("Option missing");
    const inputs = ["hello", "42.5", optionId, "2028-02-29", true, [targetId]] as const;
    for (const [index, input] of inputs.entries()) {
      const propertyId = propertyIds[index];
      if (propertyId === undefined) throw new Error("Property identity missing");
      database = updateDatabaseValue(database, recordId, propertyId, input);
    }
    expect(database.records.find((record) => record.recordId === recordId)?.values).toHaveLength(6);
    expect(database.records.find((record) => record.recordId === recordId)?.recordId).toBe(
      recordId,
    );
  });

  it("renames and removes records while preserving relation identities as unavailable", () => {
    const relationId = generateUuidV7();
    const targetId = generateUuidV7();
    const sourceId = generateUuidV7();
    let database = addDatabaseProperty(
      createEmptyDatabaseAttributes(generateUuidV7()),
      "Related",
      "relation",
      () => relationId,
    );
    database = addDatabaseRecord(database, "Target", () => targetId);
    database = addDatabaseRecord(database, "Source", () => sourceId);
    database = updateDatabaseValue(database, sourceId, relationId, [targetId]);
    database = renameDatabaseRecord(database, targetId, "Renamed target");
    expect(database.records[0]?.title).toBe("Renamed target");
    database = removeDatabaseRecord(database, targetId);
    expect(database.records[0]?.values[0]).toMatchObject({ value: [targetId] });
  });

  it("clears removed select options from records", () => {
    const propertyId = generateUuidV7();
    const recordId = generateUuidV7();
    let database = addDatabaseProperty(
      createEmptyDatabaseAttributes(generateUuidV7()),
      "Status",
      "select",
      () => propertyId,
    );
    database = addSelectOption(database, propertyId, "Active");
    database = addDatabaseRecord(database, "One", () => recordId);
    const property = database.properties[0];
    const optionId = property?.type === "select" ? property.options[0]?.optionId : undefined;
    if (optionId === undefined) throw new Error("Option missing");
    database = renameSelectOption(database, propertyId, optionId, "In progress");
    expect(database.properties[0]).toMatchObject({
      options: [{ optionId, name: "In progress" }],
    });
    database = updateDatabaseValue(database, recordId, propertyId, optionId);
    expect(removeSelectOption(database, propertyId, optionId).records[0]?.values[0]).toMatchObject({
      value: null,
    });
  });
});
