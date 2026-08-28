import type { DatabaseEntryDto } from "@myownnotion/contracts";
import { type DatabaseDefinition, generateUuidV7 } from "@myownnotion/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EntryPanel } from "../src/features/databases/entry-panel.tsx";
import { TaskConfiguration } from "../src/features/databases/task-configuration.tsx";

const ids = {
  database: generateUuidV7(),
  entry: generateUuidV7(),
  revision: generateUuidV7(),
  title: generateUuidV7(),
  note: generateUuidV7(),
  status: generateUuidV7(),
  due: generateUuidV7(),
  priority: generateUuidV7(),
  todo: generateUuidV7(),
  high: generateUuidV7(),
  view: generateUuidV7(),
};

function definition(taskRoles: DatabaseDefinition["taskRoles"]): DatabaseDefinition {
  return {
    format: "myownnotion.database-definition+json",
    formatVersion: 1,
    databaseId: ids.database,
    properties: [
      {
        id: ids.title,
        name: "Title",
        type: "title",
        positionKey: "a",
        state: "active",
        config: {},
      },
      {
        id: ids.note,
        name: "Notes",
        type: "text",
        positionKey: "b",
        state: "active",
        config: {},
      },
      {
        id: ids.status,
        name: "Workflow",
        type: "status",
        positionKey: "c",
        state: "active",
        config: {
          options: [
            { id: ids.todo, label: "To do", positionKey: "a", tone: "gray", state: "active" },
          ],
        },
      },
      {
        id: ids.due,
        name: "Deadline",
        type: "date",
        positionKey: "d",
        state: "active",
        config: { mode: "date" },
      },
      {
        id: ids.priority,
        name: "Importance",
        type: "select",
        positionKey: "e",
        state: "active",
        config: {
          options: [
            { id: ids.high, label: "High", positionKey: "a", tone: "red", state: "active" },
          ],
        },
      },
    ],
    views: [
      {
        id: ids.view,
        name: "Table",
        type: "table",
        positionKey: "a",
        state: "active",
        properties: [],
        filter: { mode: "all", criteria: [] },
        sorts: [],
        group: null,
        options: { density: "comfortable", freezeTitle: true },
      },
    ],
    taskRoles,
  };
}

const taskRoles = {
  statusPropertyId: ids.status,
  dueDatePropertyId: ids.due,
  priorityPropertyId: ids.priority,
} as const;

describe("structured task surfaces (T060)", () => {
  it("configures explicit compatible roles and can disable task tracking", () => {
    const enabled = renderToStaticMarkup(
      createElement(TaskConfiguration, {
        definition: definition(taskRoles),
        onChange: vi.fn(),
      }),
    );
    expect(enabled).toContain("Suivi des tâches");
    expect(enabled).toContain("Propriété de statut de la tâche");
    expect(enabled).toContain("échéance de la tâche");
    expect(enabled).toContain("Propriété de priorité de la tâche");
    expect(enabled).toContain("Workflow");
    expect(enabled).toContain("Deadline");
    expect(enabled).toContain("Importance");
    expect(enabled).toContain("Désactiver le suivi des tâches");

    const disabled = renderToStaticMarkup(
      createElement(TaskConfiguration, {
        definition: definition(null),
        onChange: vi.fn(),
      }),
    );
    expect(disabled).toContain("Activer le suivi des tâches");
    expect(disabled).not.toContain("échéance de la tâche");
  });

  it("shows invalid role references instead of silently remapping by name", () => {
    const invalid = renderToStaticMarkup(
      createElement(TaskConfiguration, {
        definition: definition({ ...taskRoles, statusPropertyId: ids.title }),
        onChange: vi.fn(),
      }),
    );
    expect(invalid).toContain('role="alert"');
    expect(invalid).toContain("La configuration des rôles est invalide");
    expect(invalid).toContain("Désactiver le suivi des tâches");
  });

  it("presents semantic task fields, ordinary properties and the page document once", () => {
    const entry: DatabaseEntryDto = {
      databaseId: ids.database,
      entryId: ids.entry,
      revisionId: ids.revision,
      lifecycle: "active",
      title: "Ship task tracking",
      document: null,
      values: {
        [ids.note]: { kind: "text", value: "Keep the notes with the task" },
        [ids.status]: { kind: "status", optionId: ids.todo },
        [ids.due]: { kind: "date", date: "2026-09-15" },
        [ids.priority]: { kind: "select", optionId: ids.high },
      },
      relationTargets: {},
    };
    const markup = renderToStaticMarkup(
      createElement(EntryPanel, {
        entry,
        definition: definition(taskRoles),
        pageContent: createElement("p", null, "Editorial checklist and notes"),
        onSaveValues: vi.fn(),
        onClose: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Suivi des tâches"');
    expect(markup.match(/data-task-role=/g)).toHaveLength(3);
    expect(markup).toContain("Statut de la tâche");
    expect(markup).toContain("Échéance de la tâche");
    expect(markup).toContain("Priorité de la tâche");
    expect(markup).toContain('aria-label="Autres propriétés"');
    expect(markup).toContain("Notes");
    expect(markup).toContain("Editorial checklist and notes");
    expect(markup.match(/>Workflow<\/label>/g)).toHaveLength(1);
  });
});
