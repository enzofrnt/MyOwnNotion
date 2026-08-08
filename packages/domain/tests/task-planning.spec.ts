import {
  buildTaskProjections,
  filterTaskProjections,
  generateUuidV7,
  groupTaskProjectionsByStatus,
  type TaskProjectionSource,
} from "@myownnotion/domain";
import { describe, expect, it } from "vitest";

function source(
  name: string,
  tasks: ReadonlyArray<{
    title: string;
    status: "todo" | "in_progress" | "completed" | "cancelled";
    dueDate: string | null;
    priority: "none" | "low" | "medium" | "high";
  }>,
  lifecycle: "active" | "trashed" | "purged" = "active",
): TaskProjectionSource {
  return {
    id: generateUuidV7(),
    name,
    lifecycle,
    pageDocument: {
      format: "myownnotion.document+json",
      formatVersion: 4,
      body: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: tasks.map((task) => ({
              type: "taskItem",
              attrs: {
                checked: task.status === "completed",
                taskId: generateUuidV7(),
                status: task.status,
                dueDate: task.dueDate,
                priority: task.priority,
              },
              content: [
                {
                  type: "paragraph",
                  ...(task.title.length > 0
                    ? { content: [{ type: "text", text: task.title }] }
                    : {}),
                },
              ],
            })),
          },
        ],
      },
    },
  };
}

const today = "2026-08-08";

describe("task planning projection", () => {
  it("extracts active and diagnostic tasks once in stable document order", () => {
    const alpha = source("Alpha", [
      { title: "First", status: "todo", dueDate: null, priority: "none" },
      { title: "Second", status: "in_progress", dueDate: today, priority: "high" },
    ]);
    const trashed = source(
      "Trashed",
      [{ title: "Recoverable", status: "todo", dueDate: null, priority: "low" }],
      "trashed",
    );
    const tasks = buildTaskProjections([trashed, alpha]);

    expect(tasks.map((task) => [task.sourceName, task.title, task.documentOrder])).toEqual([
      ["Alpha", "First", 0],
      ["Alpha", "Second", 1],
      ["Trashed", "Recoverable", 0],
    ]);
    expect(new Set(tasks.map((task) => task.taskId)).size).toBe(3);
  });

  it.each([
    ["all", ["Undated", "Overdue", "Today", "Upcoming", "Done", "Cancelled"]],
    ["today", ["Today"]],
    ["upcoming", ["Upcoming"]],
    ["overdue", ["Overdue"]],
    ["finished", ["Done", "Cancelled"]],
  ] as const)("classifies the %s scope exactly", (scope, titles) => {
    const tasks = buildTaskProjections([
      source("Plan", [
        { title: "Undated", status: "todo", dueDate: null, priority: "none" },
        { title: "Overdue", status: "todo", dueDate: "2026-08-07", priority: "low" },
        { title: "Today", status: "in_progress", dueDate: today, priority: "high" },
        { title: "Upcoming", status: "todo", dueDate: "2026-08-09", priority: "medium" },
        { title: "Done", status: "completed", dueDate: today, priority: "none" },
        { title: "Cancelled", status: "cancelled", dueDate: "2026-08-07", priority: "high" },
      ]),
    ]);

    expect(
      filterTaskProjections(tasks, {
        today,
        scope,
        query: "",
        statuses: [],
        priorities: [],
        sort: "document_order",
      }).map((task) => task.title),
    ).toEqual(titles);
  });

  it("combines text, status, and priority filters without mutating input", () => {
    const tasks = buildTaskProjections([
      source("Roadmap", [
        { title: "Ship Alpha", status: "in_progress", dueDate: today, priority: "high" },
        { title: "Ship Beta", status: "todo", dueDate: today, priority: "low" },
      ]),
      source("Alpha notes", [
        { title: "Review", status: "in_progress", dueDate: today, priority: "high" },
      ]),
    ]);
    const before = structuredClone(tasks);
    const filtered = filterTaskProjections(tasks, {
      today,
      scope: "today",
      query: "alpha",
      statuses: ["in_progress"],
      priorities: ["high"],
      sort: "priority",
    });

    expect(filtered.map((task) => task.title)).toEqual(["Review", "Ship Alpha"]);
    expect(tasks).toEqual(before);
  });

  it("sorts due date, priority, source, and document order deterministically", () => {
    const tasks = buildTaskProjections([
      source("Zulu", [
        { title: "Undated", status: "todo", dueDate: null, priority: "none" },
        { title: "High", status: "todo", dueDate: "2026-08-10", priority: "high" },
      ]),
      source("Alpha", [
        { title: "Soon", status: "todo", dueDate: "2026-08-09", priority: "medium" },
      ]),
    ]);
    const view = (sort: "due_date" | "priority" | "source_page" | "document_order") =>
      filterTaskProjections(tasks, {
        today,
        scope: "all",
        query: "",
        statuses: [],
        priorities: [],
        sort,
      }).map((task) => task.title);

    expect(view("due_date")).toEqual(["Soon", "High", "Undated"]);
    expect(view("priority")).toEqual(["High", "Soon", "Undated"]);
    expect(view("source_page")).toEqual(["Soon", "Undated", "High"]);
    expect(view("document_order")).toEqual(["Soon", "Undated", "High"]);
  });

  it("groups the exact filtered identities for list and board parity", () => {
    const tasks = buildTaskProjections([
      source("Board", [
        { title: "Todo", status: "todo", dueDate: null, priority: "none" },
        { title: "Doing", status: "in_progress", dueDate: null, priority: "medium" },
        { title: "Done", status: "completed", dueDate: null, priority: "high" },
        { title: "Nope", status: "cancelled", dueDate: null, priority: "low" },
      ]),
    ]);
    const grouped = groupTaskProjectionsByStatus(tasks);
    const boardIds = [
      ...grouped.todo,
      ...grouped.in_progress,
      ...grouped.completed,
      ...grouped.cancelled,
    ].map((task) => task.taskId);

    expect(new Set(boardIds)).toEqual(new Set(tasks.map((task) => task.taskId)));
    expect(boardIds).toHaveLength(tasks.length);
  });

  it("ignores legacy, invalid, folder, null, and purged documents safely", () => {
    const valid = source("Valid", [
      { title: "Visible", status: "todo", dueDate: null, priority: "none" },
    ]);
    expect(
      buildTaskProjections([
        valid,
        {
          ...valid,
          id: generateUuidV7(),
          name: "Legacy",
          pageDocument: {
            format: "myownnotion.document+json",
            formatVersion: 3,
            body: valid.pageDocument?.body ?? {},
          },
        },
        { ...valid, id: generateUuidV7(), name: "Purged", lifecycle: "purged" },
        { ...valid, id: generateUuidV7(), name: "Missing", pageDocument: null },
      ]).map((task) => task.title),
    ).toEqual(["Visible"]);
  });

  it("keeps duplicate and empty titles as independent nested task identities", () => {
    const parentId = generateUuidV7();
    const childId = generateUuidV7();
    const pageId = generateUuidV7();
    const longTitle = "A".repeat(2_000);
    const tasks = buildTaskProjections([
      {
        id: pageId,
        name: "Nested",
        lifecycle: "active",
        pageDocument: {
          format: "myownnotion.document+json",
          formatVersion: 4,
          body: {
            type: "doc",
            content: [
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: {
                      checked: false,
                      taskId: parentId,
                      status: "todo",
                      dueDate: null,
                      priority: "none",
                    },
                    content: [
                      { type: "paragraph", content: [{ type: "text", text: longTitle }] },
                      {
                        type: "taskList",
                        content: [
                          {
                            type: "taskItem",
                            attrs: {
                              checked: false,
                              taskId: childId,
                              status: "todo",
                              dueDate: null,
                              priority: "none",
                            },
                            content: [{ type: "paragraph" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    ]);
    expect(tasks.map((task) => [task.taskId, task.title, task.depth])).toEqual([
      [parentId, longTitle, 0],
      [childId, "", 1],
    ]);
  });
});
