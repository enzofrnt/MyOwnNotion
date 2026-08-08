import type { Uuid } from "../ids/uuid.ts";
import {
  EDITOR_DOCUMENT_VERSION,
  extractTaskOccurrences,
  normalizePageDocumentForEditor,
  TASK_EDITOR_DOCUMENT_VERSION,
  type TaskOccurrence,
  type TaskPriority,
  type TaskStatus,
} from "./editor-document.ts";
import type { PageDocument } from "./types.ts";

export const TASK_SCOPES = ["all", "today", "upcoming", "overdue", "finished"] as const;
export const TASK_SORTS = ["due_date", "priority", "source_page", "document_order"] as const;

export type TaskScope = (typeof TASK_SCOPES)[number];
export type TaskSort = (typeof TASK_SORTS)[number];

export interface TaskProjectionSource {
  readonly id: Uuid;
  readonly name: string;
  readonly lifecycle: "active" | "trashed" | "purged";
  readonly pageDocument: PageDocument | null;
}

export interface TaskProjection extends TaskOccurrence {
  readonly sourceItemId: Uuid;
  readonly sourceName: string;
  readonly sourceLifecycle: "active" | "trashed" | "purged";
}

export interface TaskViewQuery {
  readonly today: string;
  readonly scope: TaskScope;
  readonly query: string;
  readonly statuses: ReadonlyArray<TaskStatus>;
  readonly priorities: ReadonlyArray<TaskPriority>;
  readonly sort: TaskSort;
}

export type TaskGroups = Readonly<Record<TaskStatus, readonly TaskProjection[]>>;

function normalized(value: string): string {
  return value.normalize("NFKD").toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function projectionTieBreak(left: TaskProjection, right: TaskProjection): number {
  return (
    compareStrings(normalized(left.sourceName), normalized(right.sourceName)) ||
    compareStrings(left.sourceItemId, right.sourceItemId) ||
    left.documentOrder - right.documentOrder ||
    compareStrings(left.taskId, right.taskId)
  );
}

export function buildTaskProjections(
  sources: ReadonlyArray<TaskProjectionSource>,
): TaskProjection[] {
  return [...sources]
    .filter(
      (source) =>
        source.lifecycle !== "purged" &&
        (source.pageDocument?.formatVersion === TASK_EDITOR_DOCUMENT_VERSION ||
          source.pageDocument?.formatVersion === EDITOR_DOCUMENT_VERSION),
    )
    .sort(
      (left, right) =>
        compareStrings(normalized(left.name), normalized(right.name)) ||
        compareStrings(left.id, right.id),
    )
    .flatMap((source) => {
      const document = source.pageDocument;
      if (document === null) {
        return [];
      }
      const normalizedDocument = normalizePageDocumentForEditor(document);
      if (!normalizedDocument.ok) {
        return [];
      }
      return extractTaskOccurrences(normalizedDocument.value).map((task) => ({
        ...task,
        sourceItemId: source.id,
        sourceName: source.name,
        sourceLifecycle: source.lifecycle,
      }));
    });
}

function matchesScope(task: TaskProjection, scope: TaskScope, today: string): boolean {
  if (task.sourceLifecycle !== "active") {
    return false;
  }
  const finished = task.status === "completed" || task.status === "cancelled";
  switch (scope) {
    case "all":
      return true;
    case "finished":
      return finished;
    case "today":
      return !finished && task.dueDate === today;
    case "upcoming":
      return !finished && task.dueDate !== null && task.dueDate > today;
    case "overdue":
      return !finished && task.dueDate !== null && task.dueDate < today;
  }
}

const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

function compareTasks(left: TaskProjection, right: TaskProjection, sort: TaskSort): number {
  switch (sort) {
    case "due_date": {
      const leftDate = left.dueDate ?? "9999-99-99";
      const rightDate = right.dueDate ?? "9999-99-99";
      return compareStrings(leftDate, rightDate) || projectionTieBreak(left, right);
    }
    case "priority":
      return (
        PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
        projectionTieBreak(left, right)
      );
    case "source_page":
    case "document_order":
      return projectionTieBreak(left, right);
  }
}

export function filterTaskProjections(
  tasks: ReadonlyArray<TaskProjection>,
  view: TaskViewQuery,
): TaskProjection[] {
  const query = normalized(view.query.trim());
  const statuses = new Set(view.statuses);
  const priorities = new Set(view.priorities);
  return tasks
    .filter((task) => matchesScope(task, view.scope, view.today))
    .filter(
      (task) =>
        query.length === 0 ||
        normalized(task.title).includes(query) ||
        normalized(task.sourceName).includes(query),
    )
    .filter((task) => statuses.size === 0 || statuses.has(task.status))
    .filter((task) => priorities.size === 0 || priorities.has(task.priority))
    .sort((left, right) => compareTasks(left, right, view.sort));
}

export function groupTaskProjectionsByStatus(tasks: ReadonlyArray<TaskProjection>): TaskGroups {
  return {
    todo: tasks.filter((task) => task.status === "todo"),
    in_progress: tasks.filter((task) => task.status === "in_progress"),
    completed: tasks.filter((task) => task.status === "completed"),
    cancelled: tasks.filter((task) => task.status === "cancelled"),
  };
}
