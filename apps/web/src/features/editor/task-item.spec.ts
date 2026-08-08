import { generateUuidV7 } from "@myownnotion/domain";
import { describe, expect, it } from "vitest";
import {
  applyTaskMetadata,
  normalizeTaskItemAttributes,
  taskRenderAttributes,
} from "./task-item.ts";

describe("extended task item", () => {
  it("assigns durable defaults to a legacy unchecked task", () => {
    const taskId = generateUuidV7();
    expect(normalizeTaskItemAttributes({ checked: false }, () => taskId, new Set())).toEqual({
      checked: false,
      taskId,
      status: "todo",
      dueDate: null,
      priority: "none",
    });
  });

  it("preserves valid metadata and repairs duplicate identities", () => {
    const taskId = generateUuidV7();
    const replacementId = generateUuidV7();
    const seen = new Set<string>();
    const attrs = {
      checked: false,
      taskId,
      status: "in_progress",
      dueDate: "2028-02-29",
      priority: "high",
    };
    expect(normalizeTaskItemAttributes(attrs, () => replacementId, seen)).toEqual(attrs);
    expect(normalizeTaskItemAttributes(attrs, () => replacementId, seen)).toEqual({
      ...attrs,
      taskId: replacementId,
    });
  });

  it("maps checkbox toggles to completed and todo", () => {
    const taskId = generateUuidV7();
    const base = {
      checked: false,
      taskId,
      status: "in_progress",
      dueDate: null,
      priority: "medium",
    };
    expect(
      normalizeTaskItemAttributes({ ...base, checked: true }, generateUuidV7, new Set()).status,
    ).toBe("completed");
    expect(
      normalizeTaskItemAttributes(
        { ...base, checked: false, status: "completed" },
        generateUuidV7,
        new Set(),
      ).status,
    ).toBe("todo");
  });

  it.each([
    ["todo", false],
    ["in_progress", false],
    ["completed", true],
    ["cancelled", false],
  ] as const)("applies %s with a consistent checkbox", (status, checked) => {
    const attrs = normalizeTaskItemAttributes({ checked: false }, generateUuidV7, new Set());
    expect(applyTaskMetadata(attrs, { status })).toEqual({ ...attrs, status, checked });
  });

  it("applies and clears real dates and priorities while rejecting impossible dates", () => {
    const attrs = normalizeTaskItemAttributes({ checked: false }, generateUuidV7, new Set());
    expect(applyTaskMetadata(attrs, { dueDate: "2028-02-29", priority: "high" })).toEqual({
      ...attrs,
      dueDate: "2028-02-29",
      priority: "high",
    });
    expect(applyTaskMetadata(attrs, { dueDate: "2027-02-29" })).toBeNull();
    expect(applyTaskMetadata(attrs, { dueDate: null, priority: "none" })).toEqual(attrs);
  });

  it("renders stable non-color task semantics", () => {
    const attrs = normalizeTaskItemAttributes(
      {
        checked: false,
        status: "cancelled",
        dueDate: "2026-08-08",
        priority: "low",
      },
      generateUuidV7,
      new Set(),
    );
    expect(taskRenderAttributes(attrs)).toEqual({
      "data-task-id": attrs.taskId,
      "data-task-status": "cancelled",
      "data-task-due-date": "2026-08-08",
      "data-task-priority": "low",
    });
  });
});
