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
    expect(enabled).toContain("Task tracking");
    expect(enabled).toContain("Task status property");
    expect(enabled).toContain("Task due date property");
    expect(enabled).toContain("Task priority property");
    expect(enabled).toContain("Workflow");
    expect(enabled).toContain("Deadline");
    expect(enabled).toContain("Importance");
    expect(enabled).toContain("Disable task tracking");

    const disabled = renderToStaticMarkup(
      createElement(TaskConfiguration, {
        definition: definition(null),
        onChange: vi.fn(),
      }),
    );
    expect(disabled).toContain("Enable task tracking");
    expect(disabled).not.toContain("Task due date property");
  });

  it("shows invalid role references instead of silently remapping by name", () => {
    const invalid = renderToStaticMarkup(
      createElement(TaskConfiguration, {
        definition: definition({ ...taskRoles, statusPropertyId: ids.title }),
        onChange: vi.fn(),
      }),
    );
    expect(invalid).toContain('role="alert"');
    expect(invalid).toContain("Task role configuration is invalid");
    expect(invalid).toContain("Disable task tracking");
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

    expect(markup).toContain('aria-label="Task tracking"');
    expect(markup.match(/data-task-role=/g)).toHaveLength(3);
    expect(markup).toContain("Task status");
    expect(markup).toContain("Task due date");
    expect(markup).toContain("Task priority");
    expect(markup).toContain('aria-label="Other properties"');
    expect(markup).toContain("Notes");
    expect(markup).toContain("Editorial checklist and notes");
    expect(markup.match(/>Workflow<\/label>/g)).toHaveLength(1);
  });
});
