import { generateUuidV7 } from "@myownnotion/domain";
import { expect, it, vi } from "vitest";
import {
  updateDatabaseCell,
  updatedCellProperties,
} from "../src/features/databases/update-database-cell.ts";
import type { LocalContentService } from "../src/services/local-content.ts";

it("resolves a board move against full current values and keeps memberships absent from a stale card", () => {
  const propertyId = generateUuidV7();
  const a = generateUuidV7(),
    b = generateUuidV7(),
    c = generateUuidV7();
  const values = { [propertyId]: { kind: "multi-select" as const, optionIds: [a, b] } };
  const moved = updatedCellProperties(
    values,
    {},
    { kind: "property", propertyId, optionMove: { from: a, to: c } },
  );
  expect(moved.values[propertyId]).toEqual({ kind: "multi-select", optionIds: [b, c].sort() });
  expect(
    updatedCellProperties(
      values,
      {},
      { kind: "property", propertyId, optionMove: { from: a, to: b } },
    ).values[propertyId],
  ).toEqual({ kind: "multi-select", optionIds: [b] });
  expect(
    updatedCellProperties(
      values,
      {},
      { kind: "property", propertyId, optionMove: { from: a, to: "missing" } },
    ).values[propertyId],
  ).toBeUndefined();
  expect(() =>
    updatedCellProperties(
      values,
      {},
      { kind: "property", propertyId, optionMove: { from: c, to: b } },
    ),
  ).toThrow();
  expect(values[propertyId]?.optionIds).toEqual([a, b]);
});

it("replaces a relation with a scalar, clears absent values and preserves the source projection", () => {
  const propertyId = generateUuidV7();
  const otherProperty = generateUuidV7();
  const targetId = generateUuidV7();
  const values = { [otherProperty]: { kind: "checkbox" as const, checked: true } };
  const relations = { [propertyId]: [targetId] };
  const scalar = updatedCellProperties(values, relations, {
    kind: "property",
    propertyId,
    value: { kind: "text", value: "Une valeur" },
  });
  expect(scalar.relationTargets).toEqual({});
  expect(scalar.values[propertyId]).toEqual({ kind: "text", value: "Une valeur" });
  const cleared = updatedCellProperties(scalar.values, relations, { kind: "property", propertyId });
  expect(cleared.values).toEqual(values);
  expect(cleared.relationTargets).toEqual({});
  const relation = updatedCellProperties(
    scalar.values,
    {},
    {
      kind: "property",
      propertyId,
      relationTargets: [],
    },
  );
  expect(relation.values).toEqual(values);
  expect(relation.relationTargets).toEqual({ [propertyId]: [] });
  expect(relations).toEqual({ [propertyId]: [targetId] });
  expect(values).toEqual({ [otherProperty]: { kind: "checkbox", checked: true } });
});

it("keeps the full-page missing-entry refusal and the embedded creation policy distinct", async () => {
  const databaseId = generateUuidV7();
  const entryId = generateUuidV7();
  const propertyId = generateUuidV7();
  const revisionId = generateUuidV7();
  const replace = vi.fn().mockResolvedValue({ ok: true });
  const relationRead = vi.fn().mockResolvedValue({});
  const service = {
    getItem: vi.fn().mockResolvedValue({ currentRevisionId: revisionId }),
    getDatabaseEntry: vi.fn().mockResolvedValue(null),
    getDatabaseEntryRelationTargets: relationRead,
    replaceDatabaseEntryValues: replace,
  } as unknown as LocalContentService;
  const update = {
    kind: "property" as const,
    propertyId,
    value: { kind: "checkbox" as const, checked: true },
  };
  await expect(
    updateDatabaseCell(service, databaseId, entryId, update, {
      missingItemMessage: "Élément absent",
      missingEntryMessage: "Entrée absente",
    }),
  ).rejects.toThrow("Entrée absente");
  expect(relationRead).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
  await updateDatabaseCell(service, databaseId, entryId, update, {
    missingItemMessage: "Élément absent",
  });
  expect(replace).toHaveBeenCalledWith(databaseId, entryId, {
    baseRevisionId: revisionId,
    values: { [propertyId]: { kind: "checkbox", checked: true } },
    relationTargets: {},
  });
});
