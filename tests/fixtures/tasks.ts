import { generateUuidV7, type Uuid } from "@myownnotion/domain";

export type TaskFixtureStatus = "todo" | "in_progress" | "completed" | "cancelled";
export type TaskFixturePriority = "none" | "low" | "medium" | "high";

export interface TaskFixtureInput {
  readonly taskId?: Uuid;
  readonly title: string;
  readonly status?: TaskFixtureStatus;
  readonly dueDate?: string | null;
  readonly priority?: TaskFixturePriority;
}

export interface TaskPageFixture {
  readonly id: Uuid;
  readonly name: string;
  readonly lifecycle: "active" | "trashed";
  readonly pageDocument: {
    readonly format: "myownnotion.document+json";
    readonly formatVersion: 4;
    readonly body: Record<string, unknown>;
  };
}

export const TASK_CALENDAR_FIXTURE = {
  yesterday: "2026-08-07",
  today: "2026-08-08",
  tomorrow: "2026-08-09",
  leapDay: "2028-02-29",
} as const;

export function buildTaskDocument(tasks: readonly TaskFixtureInput[]) {
  return {
    format: "myownnotion.document+json" as const,
    formatVersion: 4 as const,
    body: {
      type: "doc",
      content:
        tasks.length === 0
          ? [{ type: "paragraph" }]
          : [
              {
                type: "taskList",
                content: tasks.map((task) => {
                  const status = task.status ?? "todo";
                  return {
                    type: "taskItem",
                    attrs: {
                      checked: status === "completed",
                      taskId: task.taskId ?? generateUuidV7(),
                      status,
                      dueDate: task.dueDate ?? null,
                      priority: task.priority ?? "none",
                    },
                    content: [
                      {
                        type: "paragraph",
                        ...(task.title.length > 0
                          ? { content: [{ type: "text", text: task.title }] }
                          : {}),
                      },
                    ],
                  };
                }),
              },
            ],
    },
  };
}

/** Builds a bounded deterministic mix of task states and dates. */
export function buildTaskFixture(taskCount: number): TaskPageFixture[] {
  if (!Number.isInteger(taskCount) || taskCount < 0) {
    throw new Error("taskCount must be a non-negative integer");
  }
  const statuses: TaskFixtureStatus[] = ["todo", "in_progress", "completed", "cancelled"];
  const priorities: TaskFixturePriority[] = ["none", "low", "medium", "high"];
  const dates = [
    null,
    TASK_CALENDAR_FIXTURE.yesterday,
    TASK_CALENDAR_FIXTURE.today,
    TASK_CALENDAR_FIXTURE.tomorrow,
  ] as const;

  return Array.from({ length: Math.ceil(taskCount / 25) }, (_, pageIndex) => {
    const pageTaskCount = Math.min(25, taskCount - pageIndex * 25);
    return {
      id: generateUuidV7(),
      name: `Task page ${String(pageIndex).padStart(3, "0")}`,
      lifecycle: "active" as const,
      pageDocument: buildTaskDocument(
        Array.from({ length: pageTaskCount }, (_, taskIndex) => {
          const index = pageIndex * 25 + taskIndex;
          return {
            title: `Task ${String(index).padStart(5, "0")}`,
            status: statuses[index % statuses.length] ?? "todo",
            priority: priorities[(index * 3) % priorities.length] ?? "none",
            dueDate: dates[(index * 5) % dates.length] ?? null,
          };
        }),
      ),
    };
  });
}
