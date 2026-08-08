import {
  createEmptyDatabaseAttributes,
  type DatabaseBlockAttributes,
  type DatabaseProperty,
  type DatabaseValue,
  databaseRelationDiagnostics,
  generateUuidV7,
  groupDatabaseRecords,
  projectDatabaseRecords,
  readableDatabaseValue,
  validateDatabaseBlockAttributes,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { buildDatabaseFixture } from "../../../tests/fixtures/databases.ts";

function sortFixture(
  property: DatabaseProperty,
  left: DatabaseValue,
  right: DatabaseValue,
): DatabaseBlockAttributes {
  return {
    databaseId: generateUuidV7(),
    schemaVersion: 1,
    properties: [property],
    records: [
      { recordId: generateUuidV7(), title: "Left", values: [left] },
      { recordId: generateUuidV7(), title: "Right", values: [right] },
    ],
    view: {
      mode: "table",
      query: "",
      sortPropertyId: property.propertyId,
      sortDirection: "asc",
      boardGroupPropertyId: null,
    },
  };
}

describe("structured database domain", () => {
  it("accepts every supported property/value type and stable identity", () => {
    const database = buildDatabaseFixture(8, 6);
    expect(validateDatabaseBlockAttributes(database)).toEqual({ ok: true, value: database });
  });

  it("creates a minimal table view with no optional schema", () => {
    const databaseId = generateUuidV7();
    expect(createEmptyDatabaseAttributes(databaseId)).toEqual({
      databaseId,
      schemaVersion: 1,
      properties: [],
      records: [],
      view: {
        mode: "table",
        query: "",
        sortPropertyId: null,
        sortDirection: "asc",
        boardGroupPropertyId: null,
      },
    });
  });

  it.each([
    [
      "duplicate property id",
      (database: ReturnType<typeof buildDatabaseFixture>) => ({
        ...database,
        properties: [database.properties[0], database.properties[0]],
      }),
    ],
    [
      "duplicate property name",
      (database: ReturnType<typeof buildDatabaseFixture>) => ({
        ...database,
        properties: [
          database.properties[0],
          { ...database.properties[1], name: database.properties[0]?.name },
        ],
      }),
    ],
    [
      "duplicate record id",
      (database: ReturnType<typeof buildDatabaseFixture>) => ({
        ...database,
        records: [database.records[0], database.records[0]],
      }),
    ],
    [
      "unknown property value",
      (database: ReturnType<typeof buildDatabaseFixture>) => ({
        ...database,
        records: [
          {
            ...database.records[0],
            values: [{ propertyId: generateUuidV7(), type: "text", value: "orphan" }],
          },
        ],
      }),
    ],
  ])("rejects %s without private content", (_label, mutate) => {
    const result = validateDatabaseBlockAttributes(mutate(buildDatabaseFixture(2, 6)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.title).not.toContain("Record");
  });

  it("rejects impossible dates, non-finite numbers, unknown options, and type mismatches", () => {
    const database = buildDatabaseFixture(1, 6);
    const cases = [
      { type: "date", value: "2027-02-29" },
      { type: "number", value: Number.POSITIVE_INFINITY },
      { type: "select", value: generateUuidV7() },
      { type: "text", value: 42 },
    ];
    for (const input of cases) {
      const property = database.properties.find((entry) => entry.type === input.type);
      expect(property).toBeDefined();
      const record = database.records[0];
      const result = validateDatabaseBlockAttributes({
        ...database,
        records: [
          {
            ...record,
            values: [
              ...(record?.values.filter((entry) => entry.propertyId !== property?.propertyId) ??
                []),
              { propertyId: property?.propertyId, type: property?.type, value: input.value },
            ],
          },
        ],
      });
      expect(result.ok).toBe(false);
    }
  });

  it("enforces property, record, option, and relation target limits", () => {
    expect(validateDatabaseBlockAttributes(buildDatabaseFixture(1, 21)).ok).toBe(false);
    expect(validateDatabaseBlockAttributes(buildDatabaseFixture(1_001, 1)).ok).toBe(false);
    const selectDatabase = buildDatabaseFixture(1, 3);
    const selectProperty = selectDatabase.properties.find((property) => property.type === "select");
    if (selectProperty === undefined || selectProperty.type !== "select") {
      throw new Error("Select fixture missing");
    }
    expect(
      validateDatabaseBlockAttributes({
        ...selectDatabase,
        properties: selectDatabase.properties.map((property) =>
          property.propertyId === selectProperty.propertyId
            ? {
                ...selectProperty,
                options: Array.from({ length: 51 }, (_, index) => ({
                  optionId: generateUuidV7(),
                  name: `Option ${index}`,
                })),
              }
            : property,
        ),
      }).ok,
    ).toBe(false);
    const relationDatabase = buildDatabaseFixture(1, 6);
    const relationProperty = relationDatabase.properties.find(
      (property) => property.type === "relation",
    );
    const record = relationDatabase.records[0];
    if (relationProperty === undefined || record === undefined) {
      throw new Error("Relation fixture missing");
    }
    expect(
      validateDatabaseBlockAttributes({
        ...relationDatabase,
        records: [
          {
            ...record,
            values: record.values.map((value) =>
              value.propertyId === relationProperty.propertyId
                ? {
                    propertyId: relationProperty.propertyId,
                    type: "relation" as const,
                    value: Array.from({ length: 201 }, () => generateUuidV7()),
                  }
                : value,
            ),
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("retains missing relation identities as explicit diagnostics", () => {
    const database = buildDatabaseFixture(2, 6);
    const relation = database.properties.find((property) => property.type === "relation");
    const missing = generateUuidV7();
    const record = database.records[0];
    if (relation === undefined || record === undefined) throw new Error("Fixture incomplete");
    const withMissing = {
      ...database,
      records: [
        {
          ...record,
          values: [
            ...record.values.filter((value) => value.propertyId !== relation.propertyId),
            { propertyId: relation.propertyId, type: "relation" as const, value: [missing] },
          ],
        },
        ...database.records.slice(1),
      ],
    };
    expect(validateDatabaseBlockAttributes(withMissing).ok).toBe(true);
    expect(databaseRelationDiagnostics(withMissing)).toEqual([
      { sourceRecordId: record.recordId, propertyId: relation.propertyId, targetRecordId: missing },
    ]);
    const firstRecord = withMissing.records[0];
    if (firstRecord === undefined) throw new Error("Fixture record missing");
    expect(readableDatabaseValue(withMissing, firstRecord, relation)).toBe("Unavailable record");
  });

  it("searches titles and readable values case-insensitively", () => {
    const database = buildDatabaseFixture(12, 6);
    expect(
      projectDatabaseRecords(database, { ...database.view, query: "TEXT 7" }).map(
        (record) => record.title,
      ),
    ).toEqual(["Record 0007"]);
  });

  it("sorts numbers type-aware in both directions and keeps empty values last", () => {
    const database = buildDatabaseFixture(12, 6);
    const numberProperty = database.properties.find((property) => property.type === "number");
    if (numberProperty === undefined) throw new Error("Number property missing");
    const withoutValue = database.records[0];
    if (withoutValue === undefined) throw new Error("Fixture record missing");
    const fixture = {
      ...database,
      records: [
        {
          ...withoutValue,
          values: withoutValue.values.filter(
            (value) => value.propertyId !== numberProperty.propertyId,
          ),
        },
        ...database.records.slice(1),
      ],
    };
    const asc = projectDatabaseRecords(fixture, {
      ...fixture.view,
      sortPropertyId: numberProperty.propertyId,
      sortDirection: "asc",
    });
    const desc = projectDatabaseRecords(fixture, {
      ...fixture.view,
      sortPropertyId: numberProperty.propertyId,
      sortDirection: "desc",
    });
    expect(asc[0]?.title).toBe("Record 0001");
    expect(asc.at(-1)?.title).toBe("Record 0000");
    expect(desc[0]?.title).toBe("Record 0011");
    expect(desc.at(-1)?.title).toBe("Record 0000");
  });

  it("sorts text, number, select, date, and checkbox values by typed semantics", () => {
    const textId = generateUuidV7();
    const numberId = generateUuidV7();
    const dateId = generateUuidV7();
    const checkboxId = generateUuidV7();
    const selectId = generateUuidV7();
    const alphaOptionId = generateUuidV7();
    const zuluOptionId = generateUuidV7();
    const fixtures = [
      sortFixture(
        { propertyId: textId, name: "Text", type: "text" },
        { propertyId: textId, type: "text", value: "Zulu" },
        { propertyId: textId, type: "text", value: "Alpha" },
      ),
      sortFixture(
        { propertyId: numberId, name: "Number", type: "number" },
        { propertyId: numberId, type: "number", value: 10 },
        { propertyId: numberId, type: "number", value: 2 },
      ),
      sortFixture(
        {
          propertyId: selectId,
          name: "Select",
          type: "select",
          options: [
            { optionId: zuluOptionId, name: "Zulu" },
            { optionId: alphaOptionId, name: "Alpha" },
          ],
        },
        { propertyId: selectId, type: "select", value: zuluOptionId },
        { propertyId: selectId, type: "select", value: alphaOptionId },
      ),
      sortFixture(
        { propertyId: dateId, name: "Date", type: "date" },
        { propertyId: dateId, type: "date", value: "2028-02-29" },
        { propertyId: dateId, type: "date", value: "2027-01-01" },
      ),
      sortFixture(
        { propertyId: checkboxId, name: "Checkbox", type: "checkbox" },
        { propertyId: checkboxId, type: "checkbox", value: true },
        { propertyId: checkboxId, type: "checkbox", value: false },
      ),
    ];
    for (const fixture of fixtures) {
      expect(validateDatabaseBlockAttributes(fixture).ok).toBe(true);
      expect(projectDatabaseRecords(fixture)[0]?.title).toBe("Right");
    }
  });

  it("sorts relations by current target titles and leaves target rows without values last", () => {
    const propertyId = generateUuidV7();
    const alphaTargetId = generateUuidV7();
    const zuluTargetId = generateUuidV7();
    const database: DatabaseBlockAttributes = {
      databaseId: generateUuidV7(),
      schemaVersion: 1,
      properties: [{ propertyId, name: "Related", type: "relation" }],
      records: [
        {
          recordId: generateUuidV7(),
          title: "Zulu source",
          values: [{ propertyId, type: "relation", value: [zuluTargetId] }],
        },
        {
          recordId: generateUuidV7(),
          title: "Alpha source",
          values: [{ propertyId, type: "relation", value: [alphaTargetId] }],
        },
        { recordId: zuluTargetId, title: "Zulu target", values: [] },
        { recordId: alphaTargetId, title: "Alpha target", values: [] },
      ],
      view: {
        mode: "table",
        query: "",
        sortPropertyId: propertyId,
        sortDirection: "asc",
        boardGroupPropertyId: null,
      },
    };
    expect(
      projectDatabaseRecords(database)
        .slice(0, 2)
        .map((record) => record.title),
    ).toEqual(["Alpha source", "Zulu source"]);
  });

  it("groups by select option order plus unassigned with exact identity parity", () => {
    const database = buildDatabaseFixture(10, 6);
    const projected = projectDatabaseRecords(database);
    const groups = groupDatabaseRecords(database, projected);
    expect(groups.at(-1)?.label).toBe("Unassigned");
    expect(groups.flatMap((group) => group.records.map((record) => record.recordId))).toEqual(
      expect.arrayContaining(projected.map((record) => record.recordId)),
    );
    expect(
      new Set(groups.flatMap((group) => group.records.map((record) => record.recordId))).size,
    ).toBe(projected.length);
  });

  it("falls back to one unassigned group without a select property", () => {
    const database = buildDatabaseFixture(3, 2);
    const withoutSelect = {
      ...database,
      properties: database.properties.filter((property) => property.type !== "select"),
      records: database.records.map((record) => ({
        ...record,
        values: record.values.filter((value) => value.type !== "select"),
      })),
      view: { ...database.view, boardGroupPropertyId: null },
    };
    expect(groupDatabaseRecords(withoutSelect)).toEqual([
      { groupId: null, label: "Unassigned", records: projectDatabaseRecords(withoutSelect) },
    ]);
  });
});
