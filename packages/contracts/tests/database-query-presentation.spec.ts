import {
  type DatabaseDefinition,
  type DatabaseQueryEntry,
  type DatabaseView,
  generateUuidV7,
  type Uuid,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import { presentDatabaseQuery } from "../src/database-query-presentation.ts";

describe("database query presentation", () => {
  const ids = {
    source: generateUuidV7(),
    view: generateUuidV7(),
    entry: generateUuidV7(),
    revision: generateUuidV7(),
    tags: generateUuidV7(),
    hidden: generateUuidV7(),
    relation: generateUuidV7(),
    option: generateUuidV7(),
  };
  const view: DatabaseView = {
    id: ids.view,
    name: "Table",
    type: "table",
    positionKey: "a",
    state: "active",
    properties: [
      { propertyId: ids.tags, visible: true, positionKey: "a" },
      { propertyId: ids.hidden, visible: false, positionKey: "b" },
      { propertyId: ids.relation, visible: true, positionKey: "c" },
    ],
    filter: { mode: "all", criteria: [] },
    sorts: [],
    group: { propertyId: ids.tags },
    options: { density: "comfortable", freezeTitle: true },
  };
  const definition: DatabaseDefinition = {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: ids.source,
    properties: [
      {
        id: ids.tags,
        name: "Statut",
        type: "status",
        state: "active",
        positionKey: "a",
        config: {
          options: [
            {
              id: ids.option,
              label: "À faire",
              positionKey: "a",
              tone: "neutral",
              state: "active",
            },
          ],
        },
      },
    ],
    views: [view],
    taskRoles: null,
  };

  it("omits hidden properties and returns independent arrays for tags and relations", () => {
    const optionIds: Uuid[] = [ids.option];
    const targetIds: Uuid[] = [ids.entry];
    const entry: DatabaseQueryEntry & { revisionId: Uuid } = {
      entryId: ids.entry,
      revisionId: ids.revision,
      title: "Entrée",
      values: {
        [ids.tags]: { kind: "multi-select", optionIds },
        [ids.hidden]: { kind: "text", value: "Masqué" },
      },
      relationTargets: { [ids.relation]: targetIds, [ids.hidden]: [ids.entry] },
    };
    const result = presentDatabaseQuery({
      definition,
      view,
      entries: [entry],
      groups: [{ id: ids.option, entryIds: [ids.entry, generateUuidV7()] }],
      includeGroups: true,
    });
    expect(result.rows).toEqual([
      {
        entryId: ids.entry,
        revisionId: ids.revision,
        title: "Entrée",
        values: { [ids.tags]: { kind: "multi-select", optionIds: [ids.option] } },
        relationTargets: { [ids.relation]: [ids.entry] },
        groupId: ids.option,
      },
    ]);
    expect(result.groups).toEqual([{ id: ids.option, label: "À faire", count: 2 }]);
    optionIds.push(generateUuidV7());
    targetIds.length = 0;
    expect(result.rows[0]?.values[ids.tags]).toEqual({
      kind: "multi-select",
      optionIds: [ids.option],
    });
    expect(result.rows[0]?.relationTargets[ids.relation]).toEqual([ids.entry]);
  });

  it("keeps incomplete coverage under caller control and labels absent or deleted options", () => {
    const groups = [
      { id: "missing", entryIds: [] },
      { id: "checked", entryIds: [] },
      { id: "unchecked", entryIds: [] },
      { id: "deleted-option", entryIds: [] },
    ];
    const input = { definition, view, entries: [], groups, includeGroups: true };
    expect(presentDatabaseQuery(input).groups.map(({ label }) => label)).toEqual([
      "Sans valeur",
      "Coché",
      "Non coché",
      "Option indisponible",
    ]);
    expect(presentDatabaseQuery({ ...input, includeGroups: false }).groups).toEqual([]);
    expect(presentDatabaseQuery({ ...input, view: { ...view, group: null } }).groups).toEqual([]);
  });
});
