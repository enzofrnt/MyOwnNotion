import { describe, expect, it } from "vitest";
import {
  asUuid,
  COMMAND_TYPES,
  createInitialDatabaseDefinition,
  parseMutationCommand,
  type Uuid,
} from "../../src/index.ts";
import { definition, IDS } from "./fixtures.ts";

const PLACEMENT_ID = asUuid("018f0000-0000-7000-8000-000000000022");
const BASE_REVISION_ID = asUuid("018f0000-0000-7000-8000-000000000023");
const REMOTE_REVISION_ID = asUuid("018f0000-0000-7000-8000-000000000025");

const placement = {
  id: PLACEMENT_ID,
  parentItemId: null,
  positionKey: "a",
};

const values = {
  [IDS.text]: { kind: "text" as const, value: "Private draft" },
  [IDS.number]: { kind: "number" as const, decimal: "12.5" },
};

const relationTargets = {
  [IDS.relation]: [IDS.entryB, IDS.entryC],
};

function parse(commandType: string, payload: Record<string, unknown>) {
  return parseMutationCommand(commandType, payload);
}

describe("structured database commands (T018)", () => {
  it("registers create, replace, and conflict-resolution commands", () => {
    expect(COMMAND_TYPES).toEqual(
      expect.arrayContaining([
        "database.create",
        "database.definition.replace",
        "database.definition.resolve-conflict",
        "database.entry.create",
        "database.entry.values.replace",
        "database.entry.values.resolve-conflict",
      ]),
    );
  });

  it("parses a page-backed database creation with stable caller-owned identities", () => {
    const result = parse("database.create", {
      id: IDS.database,
      name: " Projets ",
      placement,
      titlePropertyId: IDS.title,
      titlePropertyName: " Titre ",
      initialViewId: IDS.view,
      initialViewName: " Table principale ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.type !== "database.create") return;
    expect(result.value).toMatchObject({
      id: IDS.database,
      name: "Projets",
      titlePropertyId: IDS.title,
      titlePropertyName: "Titre",
      initialViewId: IDS.view,
      initialViewName: "Table principale",
      placement,
    });
    expect(createInitialDatabaseDefinition(result.value).properties[0]?.name).toBe("Titre");
  });

  it("parses a definition replacement tied to a base revision and confirmed impact", () => {
    const candidate = definition();
    const result = parse("database.definition.replace", {
      databaseId: IDS.database,
      baseRevisionId: BASE_REVISION_ID,
      definition: candidate,
      impactConfirmation: {
        digest: "a".repeat(64),
        decision: "preserve-incompatible",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.type !== "database.definition.replace") return;
    expect(result.value.definition).toEqual(candidate);
    expect(result.value.impactConfirmation).toEqual({
      digest: "a".repeat(64),
      decision: "preserve-incompatible",
    });
  });

  it("parses entry creation as one canonical page, membership, values and relations", () => {
    const result = parse("database.entry.create", {
      databaseId: IDS.database,
      id: IDS.entryA,
      title: " Première entrée ",
      placement,
      document: { format: "myownnotion.document+json", formatVersion: 1, body: {} },
      values,
      relationTargets,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.type !== "database.entry.create") return;
    expect(result.value.id).toBe(IDS.entryA);
    expect(result.value.title).toBe("Première entrée");
    expect(result.value.values).toEqual(values);
    expect(result.value.relationTargets).toEqual(relationTargets);
  });

  it("parses a complete desired-state value replacement", () => {
    const result = parse("database.entry.values.replace", {
      databaseId: IDS.database,
      entryId: IDS.entryA,
      baseRevisionId: BASE_REVISION_ID,
      values,
      relationTargets,
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.type !== "database.entry.values.replace") return;
    expect(result.value.values).toEqual(values);
    expect(result.value.relationTargets).toEqual(relationTargets);
  });

  it("parses definition and entry resolutions with exactly two distinct parents", () => {
    const definitionResolution = parse("database.definition.resolve-conflict", {
      databaseId: IDS.database,
      resolvedRevisionIds: [BASE_REVISION_ID, REMOTE_REVISION_ID],
      definition: definition(),
    });
    const entryResolution = parse("database.entry.values.resolve-conflict", {
      databaseId: IDS.database,
      entryId: IDS.entryA,
      resolvedRevisionIds: [BASE_REVISION_ID, REMOTE_REVISION_ID],
      values,
      relationTargets,
    });

    expect(definitionResolution.ok).toBe(true);
    expect(entryResolution.ok).toBe(true);
  });

  it.each([
    [[]],
    [[BASE_REVISION_ID]],
    [[BASE_REVISION_ID, BASE_REVISION_ID]],
    [[BASE_REVISION_ID, REMOTE_REVISION_ID, IDS.entryA]],
  ] satisfies Array<[Uuid[]]>)(
    "rejects invalid resolution parent sets %#",
    (resolvedRevisionIds) => {
      expect(
        parse("database.definition.resolve-conflict", {
          databaseId: IDS.database,
          resolvedRevisionIds,
          definition: definition(),
        }).ok,
      ).toBe(false);
      expect(
        parse("database.entry.values.resolve-conflict", {
          databaseId: IDS.database,
          entryId: IDS.entryA,
          resolvedRevisionIds,
          values,
          relationTargets,
        }).ok,
      ).toBe(false);
    },
  );

  it("parses repeated payloads to the same desired command without generating identities", () => {
    const payload = {
      databaseId: IDS.database,
      entryId: IDS.entryA,
      baseRevisionId: BASE_REVISION_ID,
      values,
      relationTargets,
    };
    const first = parse("database.entry.values.replace", payload);
    const replay = parse("database.entry.values.replace", structuredClone(payload));
    expect(first).toEqual(replay);
  });

  it.each([
    ["database.create", { ...placement, name: "Missing identities" }],
    [
      "database.definition.replace",
      {
        databaseId: IDS.database,
        baseRevisionId: BASE_REVISION_ID,
        definition: definition({ databaseId: IDS.entryA }),
      },
    ],
    [
      "database.definition.replace",
      {
        databaseId: IDS.database,
        baseRevisionId: BASE_REVISION_ID,
        definition: definition(),
        impactConfirmation: { digest: "private-content", decision: "discard-confirmed" },
      },
    ],
    [
      "database.entry.create",
      {
        databaseId: IDS.database,
        id: IDS.entryA,
        title: "Entry",
        placement,
        values: { [IDS.number]: { kind: "number", decimal: "12,5" } },
        relationTargets: {},
      },
    ],
    [
      "database.entry.values.replace",
      {
        databaseId: IDS.database,
        entryId: IDS.entryA,
        baseRevisionId: BASE_REVISION_ID,
        values: {},
        relationTargets: { [IDS.relation]: ["not-a-uuid"] },
      },
    ],
  ] satisfies Array<[string, Record<string, unknown>]>)(
    "rejects malformed or mismatched payload %# for %s",
    (commandType, payload) => {
      const result = parse(commandType, payload);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation.invalid-payload");
    },
  );

  it("rejects relation arrays with duplicate targets so cardinality is deterministic", () => {
    const duplicateTarget = IDS.entryB as Uuid;
    const result = parse("database.entry.values.replace", {
      databaseId: IDS.database,
      entryId: IDS.entryA,
      baseRevisionId: BASE_REVISION_ID,
      values: {},
      relationTargets: { [IDS.relation]: [duplicateTarget, duplicateTarget] },
    });
    expect(result.ok).toBe(false);
  });

  it("keeps editorial checkboxes inside a page document command", () => {
    const checkboxId = asUuid("018f0000-0000-7000-8000-000000000024");
    const result = parse("page.document.replace", {
      itemId: IDS.entryA,
      baseRevisionId: BASE_REVISION_ID,
      document: {
        format: "myownnotion.document+json",
        formatVersion: 2,
        body: {
          blocks: [
            {
              id: checkboxId,
              type: "checkbox",
              checked: true,
              content: [{ text: "Editorial only" }],
            },
          ],
        },
      },
      pageLinkTargetIds: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("page.document.replace");
    expect(result.value).not.toHaveProperty("databaseId");
    expect(result.value).not.toHaveProperty("values");
  });
});
