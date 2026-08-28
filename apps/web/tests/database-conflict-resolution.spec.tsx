import type { ConflictRecordRow, StructuredConflictContext } from "@myownnotion/client-core";
import type { DatabaseDefinition } from "@myownnotion/domain";
import { generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  assembleStructuredResolution,
  StructuredConflictCard,
} from "../src/features/databases/database-conflict-resolution.tsx";

const databaseId = generateUuidV7();
const titlePropertyId = generateUuidV7();
const viewId = generateUuidV7();

function definition(propertyName: string, viewName: string): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId,
    properties: [
      {
        id: titlePropertyId,
        name: propertyName,
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
    ],
    views: [
      {
        id: viewId,
        name: viewName,
        type: "table",
        positionKey: "a",
        state: "active",
        properties: [{ propertyId: titlePropertyId, visible: true, positionKey: "a" }],
        filter: { mode: "all", criteria: [] },
        sorts: [],
        group: null,
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
    taskRoles: null,
  };
}

function conflictRow(structured: StructuredConflictContext): ConflictRecordRow & {
  readonly structured: StructuredConflictContext;
} {
  return {
    mutationId: generateUuidV7(),
    commandType: "database.definition.replace",
    payload: { databaseId },
    baseRevisionIds: [generateUuidV7()],
    localRevisionIds: [generateUuidV7()],
    competingRevisionIds: [generateUuidV7()],
    capturedAt: "2026-08-20T10:00:00.000Z",
    errorCode: "revision.stale-base",
    structured,
  };
}

describe("structured database conflict resolution (T082)", () => {
  it("shows local, common, and remote schema/view states before saving", () => {
    const row = conflictRow({
      kind: "database-definition",
      conflicts: [{ path: `views.${viewId}.name`, reason: "divergent-edit" }],
      ancestor: definition("Title", "Shared table"),
      local: definition("Local title", "Local table"),
      remote: definition("Title", "Remote table"),
    });

    const markup = renderToStaticMarkup(
      createElement(StructuredConflictCard, {
        row,
        service: {} as never,
        onResolved: () => undefined,
      }),
    );

    expect(markup).toContain("Résoudre le conflit de base de données");
    expect(markup).toContain("Local table");
    expect(markup).toContain("Shared table");
    expect(markup).toContain("Remote table");
    expect(markup).toContain(`views.${viewId}.name`);
  });

  it("keeps compatible changes from both devices while applying the owner's field choice", () => {
    const context: StructuredConflictContext = {
      kind: "database-definition",
      conflicts: [{ path: `views.${viewId}.name`, reason: "divergent-edit" }],
      ancestor: definition("Title", "Shared table"),
      local: definition("Local title", "Local table"),
      remote: definition("Title", "Remote table"),
    };
    const assembled = assembleStructuredResolution(
      context,
      new Map([[`views.${viewId}.name`, "remote"]]),
    );

    expect(assembled.kind).toBe("database-definition");
    if (assembled.kind !== "database-definition") return;
    expect(assembled.definition.properties[0]?.name).toBe("Local title");
    expect(assembled.definition.views[0]?.name).toBe("Remote table");
  });
});
